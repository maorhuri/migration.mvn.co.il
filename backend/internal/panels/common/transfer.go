package common

import (
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

// TransferReporter turns the raw byte counts of a file transfer into something an operator can
// follow: a progress update with bytes/total every couple of seconds (for the UI, not logged)
// and a log line every 30 seconds with how much is done, the rate and the time left, plus a
// closing summary. Feed() takes byte deltas from the transfer (from any goroutine); total may
// be 0 when the size is unknown, in which case only the amount and rate are reported.
type TransferReporter struct {
	step     string
	total    int64
	progress chan<- MigrationProgress
	logFn    func(level, message string)

	done  atomic.Int64
	feed  chan int64
	stop  chan struct{}
	wg    sync.WaitGroup
	start time.Time
}

const (
	transferUpdateEvery = 2 * time.Second
	transferLogEvery    = 30 * time.Second
)

// NewTransferReporter creates a reporter for one transfer step; call Start, then Finish.
func NewTransferReporter(step string, total int64, progress chan<- MigrationProgress, logFn func(level, message string)) *TransferReporter {
	if logFn == nil {
		logFn = func(string, string) {}
	}
	return &TransferReporter{step: step, total: total, progress: progress, logFn: logFn, feed: make(chan int64, 256), stop: make(chan struct{})}
}

// Feed is where the transfer sends byte deltas.
func (r *TransferReporter) Feed() chan<- int64 { return r.feed }

// Start begins reporting; the first log line explains what is being measured.
func (r *TransferReporter) Start() {
	r.start = time.Now()
	if r.total > 0 {
		r.logFn("info", fmt.Sprintf("%s: %s to transfer; progress is logged every %s", r.step, HumanBytes(r.total), transferLogEvery))
	} else {
		r.logFn("info", fmt.Sprintf("%s: size unknown up front; progress is logged every %s", r.step, transferLogEvery))
	}
	r.wg.Add(1)
	go r.run()
}

func (r *TransferReporter) run() {
	defer r.wg.Done()
	update := time.NewTicker(transferUpdateEvery)
	defer update.Stop()
	lastLog := r.start
	lastLogged := int64(-1)
	for {
		select {
		case n := <-r.feed:
			r.done.Add(n)
		case <-update.C:
			done := r.done.Load()
			r.send(done)
			if time.Since(lastLog) >= transferLogEvery && done != lastLogged {
				r.logFn("info", r.line(done))
				lastLog, lastLogged = time.Now(), done
			}
		case <-r.stop:
			for {
				select {
				case n := <-r.feed:
					r.done.Add(n)
				default:
					return
				}
			}
		}
	}
}

// send pushes a bytes/total update without a log line (Logged: the step name is already there).
func (r *TransferReporter) send(done int64) {
	if r.progress == nil {
		return
	}
	total := r.total
	if total > 0 && done > total {
		done = total // tar headers make the stream slightly bigger than the files themselves
	}
	r.progress <- MigrationProgress{Status: "running", CurrentStep: r.step, BytesTransferred: done, TotalBytes: total, Logged: true}
}

func (r *TransferReporter) line(done int64) string {
	elapsed := time.Since(r.start)
	rate := float64(done) / elapsed.Seconds()
	if r.total <= 0 {
		return fmt.Sprintf("%s: %s so far at %s/s (%s elapsed)", r.step, HumanBytes(done), HumanBytes(int64(rate)), elapsed.Round(time.Second))
	}
	pct := int(float64(done) * 100 / float64(r.total))
	if pct > 99 {
		pct = 99
	}
	left := "unknown time"
	if rate > 0 && done < r.total {
		left = "about " + (time.Duration(float64(r.total-done)/rate) * time.Second).Round(time.Second).String()
	} else if done >= r.total {
		left = "finishing"
	}
	return fmt.Sprintf("%s: %s of %s (%d%%) at %s/s, %s left", r.step, HumanBytes(done), HumanBytes(r.total), pct, HumanBytes(int64(rate)), left)
}

// Finish stops reporting and logs the summary; safe to call once.
func (r *TransferReporter) Finish() {
	close(r.stop)
	r.wg.Wait()
	done := r.done.Load()
	elapsed := time.Since(r.start)
	rate := int64(0)
	if elapsed > 0 {
		rate = int64(float64(done) / elapsed.Seconds())
	}
	r.send(done)
	r.logFn("info", fmt.Sprintf("%s: %s in %s (%s/s)", r.step, HumanBytes(done), elapsed.Round(time.Second), HumanBytes(rate)))
}

// HumanBytes formats a byte count for people (1.5 GB, 320 MB, 12 KB).
func HumanBytes(n int64) string {
	const unit = 1024
	if n < unit {
		return fmt.Sprintf("%d B", n)
	}
	div, exp := int64(unit), 0
	for m := n / unit; m >= unit && exp < 4; m /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(n)/float64(div), "KMGTP"[exp])
}
