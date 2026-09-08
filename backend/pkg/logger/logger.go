// Package logger provides structured logging
package logger

import (
	"io"
	"os"
	"time"

	"github.com/rs/zerolog"
)

// Logger wraps zerolog for structured logging
type Logger struct {
	log zerolog.Logger
}

// Config holds logger configuration
type Config struct {
	Level      string
	Pretty     bool
	Output     io.Writer
}

// New creates a new logger
func New(cfg *Config) *Logger {
	if cfg == nil {
		cfg = &Config{
			Level:  "info",
			Pretty: true,
		}
	}

	var output io.Writer = os.Stdout
	if cfg.Output != nil {
		output = cfg.Output
	}

	if cfg.Pretty {
		output = zerolog.ConsoleWriter{
			Out:        output,
			TimeFormat: time.RFC3339,
		}
	}

	level, err := zerolog.ParseLevel(cfg.Level)
	if err != nil {
		level = zerolog.InfoLevel
	}

	log := zerolog.New(output).
		Level(level).
		With().
		Timestamp().
		Logger()

	return &Logger{log: log}
}

// Debug logs a debug message
func (l *Logger) Debug(msg string, fields ...map[string]interface{}) {
	event := l.log.Debug()
	if len(fields) > 0 {
		event = event.Fields(fields[0])
	}
	event.Msg(msg)
}

// Info logs an info message
func (l *Logger) Info(msg string, fields ...map[string]interface{}) {
	event := l.log.Info()
	if len(fields) > 0 {
		event = event.Fields(fields[0])
	}
	event.Msg(msg)
}

// Warn logs a warning message
func (l *Logger) Warn(msg string, fields ...map[string]interface{}) {
	event := l.log.Warn()
	if len(fields) > 0 {
		event = event.Fields(fields[0])
	}
	event.Msg(msg)
}

// Error logs an error message
func (l *Logger) Error(msg string, err error, fields ...map[string]interface{}) {
	event := l.log.Error()
	if err != nil {
		event = event.Err(err)
	}
	if len(fields) > 0 {
		event = event.Fields(fields[0])
	}
	event.Msg(msg)
}

// Fatal logs a fatal message and exits
func (l *Logger) Fatal(msg string, err error, fields ...map[string]interface{}) {
	event := l.log.Fatal()
	if err != nil {
		event = event.Err(err)
	}
	if len(fields) > 0 {
		event = event.Fields(fields[0])
	}
	event.Msg(msg)
}

// With returns a new logger with additional fields
func (l *Logger) With(fields map[string]interface{}) *Logger {
	return &Logger{
		log: l.log.With().Fields(fields).Logger(),
	}
}

// WithComponent returns a new logger with a component field
func (l *Logger) WithComponent(component string) *Logger {
	return &Logger{
		log: l.log.With().Str("component", component).Logger(),
	}
}
