package daemon

import (
	"context"
	"strings"

	"github.com/multica-ai/multica/server/pkg/agent"
)

func (d *Daemon) registerActiveSession(taskID string, control agent.SessionControl) {
	if control == nil || strings.TrimSpace(taskID) == "" {
		return
	}
	d.activeSessionsMu.Lock()
	if d.activeSessions == nil {
		d.activeSessions = make(map[string]agent.SessionControl)
	}
	d.activeSessions[taskID] = control
	d.activeSessionsMu.Unlock()
}

func (d *Daemon) unregisterActiveSession(taskID string, control agent.SessionControl) {
	d.activeSessionsMu.Lock()
	defer d.activeSessionsMu.Unlock()
	if current := d.activeSessions[taskID]; current == control {
		delete(d.activeSessions, taskID)
	}
}

// SteerTask inserts input into the live provider turn owned by taskID.
func (d *Daemon) SteerTask(ctx context.Context, taskID, input, clientUserMessageID string) agent.SteeringResult {
	d.activeSessionsMu.RLock()
	control := d.activeSessions[taskID]
	d.activeSessionsMu.RUnlock()
	if control == nil {
		return agent.SteeringResult{
			Status: agent.SteeringSessionClosed,
			Error:  "task session is not active",
		}
	}
	return control.Steer(ctx, input, clientUserMessageID)
}
