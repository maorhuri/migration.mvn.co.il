package common

import (
	"strings"
	"testing"
	"time"
)

func TestTransferReporter(t *testing.T) {
	progress := make(chan MigrationProgress, 100)
	var logs []string
	r := NewTransferReporter("Downloading files", 10*1024*1024, progress, func(level, msg string) { logs = append(logs, level+": "+msg) })
	r.Start()
	r.Feed() <- 4 * 1024 * 1024
	r.Feed() <- 4 * 1024 * 1024
	r.Feed() <- 4 * 1024 * 1024 // more than the total: tar headers, clamped in the update
	time.Sleep(10 * time.Millisecond)
	r.Finish()
	close(progress)

	var last MigrationProgress
	n := 0
	for p := range progress {
		n++
		last = p
		if !p.Logged || p.CurrentStep != "Downloading files" {
			t.Errorf("progress update must carry the step name and not be logged again: %+v", p)
		}
	}
	if n == 0 {
		t.Fatal("no progress update sent")
	}
	if last.BytesTransferred != 10*1024*1024 || last.TotalBytes != 10*1024*1024 {
		t.Errorf("final update should be clamped to the total: %+v", last)
	}
	if len(logs) != 2 || !strings.Contains(logs[0], "10.0 MB to transfer") || !strings.Contains(logs[1], "Downloading files: 12.0 MB in") {
		t.Errorf("unexpected log lines: %q", logs)
	}

	unknown := NewTransferReporter("Uploading", 0, nil, nil)
	if line := unknown.line(3 * 1024 * 1024); !strings.Contains(line, "3.0 MB so far") {
		t.Errorf("unknown-total line: %s", line)
	}
	r2 := NewTransferReporter("Downloading files", 100, nil, nil)
	r2.start = time.Now().Add(-10 * time.Second)
	if line := r2.line(50); !strings.Contains(line, "50 B of 100 B (50%)") || !strings.Contains(line, "about 10s left") {
		t.Errorf("eta line: %s", line)
	}
}

func TestHumanBytes(t *testing.T) {
	for in, want := range map[int64]string{0: "0 B", 1023: "1023 B", 1536: "1.5 KB", 24 * 1024 * 1024 * 1024: "24.0 GB"} {
		if got := HumanBytes(in); got != want {
			t.Errorf("HumanBytes(%d) = %q, want %q", in, got, want)
		}
	}
}
