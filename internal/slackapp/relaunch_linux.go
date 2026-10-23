// Package slackapp keeps the Slack app running with its DevTools endpoint.
package slackapp

import (
	"context"
	"errors"

	"go.uber.org/zap"
)

// Options configures Watch.
type Options struct {
	CDPURL  string
	NewOnly bool
}

// Watch is only implemented on macOS.
func Watch(context.Context, *zap.Logger, Options) error {
	return errors.New("SLACK_RELAUNCH is only supported on macOS")
}
