package daemon

import (
	"context"
	"time"

	"github.com/multica-ai/multica/server/pkg/agent"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

const planLimitsRefreshInterval = time.Minute

func (d *Daemon) refreshPlanLimits(ctx context.Context, runtimeID string) {
	d.mu.Lock()
	runtime, ok := d.runtimeIndex[runtimeID]
	d.mu.Unlock()
	if !ok || runtime.Provider != "grok" {
		return
	}

	now := time.Now()
	d.planLimitsMu.Lock()
	if d.planLimitsFetchedAt == nil {
		d.planLimitsFetchedAt = make(map[string]time.Time)
	}
	if fetchedAt, exists := d.planLimitsFetchedAt[runtimeID]; exists && now.Sub(fetchedAt) < planLimitsRefreshInterval {
		d.planLimitsMu.Unlock()
		return
	}
	d.planLimitsFetchedAt[runtimeID] = now
	d.planLimitsMu.Unlock()

	snapshot, err := agent.FetchGrokPlanLimits(ctx, nil)
	if err != nil {
		d.logger.Debug("grok plan limits unavailable", "runtime_id", runtimeID, "error", err)
		return
	}
	d.recordPlanLimits(runtimeID, snapshot)
}

// recordPlanLimits keeps the newest provider snapshot in daemon memory until a
// heartbeat delivers it. Built-in runtimes for the same provider share one CLI
// account across watched workspaces, so a snapshot observed on one is copied to
// its siblings. Custom-profile runtimes remain isolated because their command
// can authenticate as a different provider account.
func (d *Daemon) recordPlanLimits(runtimeID string, snapshot *protocol.PlanLimitsSnapshot) {
	if snapshot == nil || runtimeID == "" {
		return
	}

	d.mu.Lock()
	source, ok := d.runtimeIndex[runtimeID]
	if !ok {
		d.mu.Unlock()
		return
	}
	targets := []string{runtimeID}
	if source.ProfileID == "" {
		targets = targets[:0]
		for id, runtime := range d.runtimeIndex {
			if runtime.ProfileID == "" && runtime.Provider == source.Provider {
				targets = append(targets, id)
			}
		}
	}
	d.mu.Unlock()

	copySnapshot := clonePlanLimitsSnapshot(snapshot)
	copySnapshot.Provider = source.Provider
	d.planLimitsMu.Lock()
	if d.planLimits == nil {
		d.planLimits = make(map[string]protocol.PlanLimitsSnapshot)
	}
	for _, id := range targets {
		d.planLimits[id] = copySnapshot
	}
	d.planLimitsMu.Unlock()
}

func (d *Daemon) planLimitsForRuntime(runtimeID string) *protocol.PlanLimitsSnapshot {
	d.planLimitsMu.RLock()
	snapshot, ok := d.planLimits[runtimeID]
	d.planLimitsMu.RUnlock()
	if !ok {
		return nil
	}
	cloned := clonePlanLimitsSnapshot(&snapshot)
	return &cloned
}

func clonePlanLimitsSnapshot(snapshot *protocol.PlanLimitsSnapshot) protocol.PlanLimitsSnapshot {
	cloned := *snapshot
	cloned.Windows = make([]protocol.PlanLimitWindow, len(snapshot.Windows))
	for i, window := range snapshot.Windows {
		cloned.Windows[i] = window
		if window.UsedPercent != nil {
			value := *window.UsedPercent
			cloned.Windows[i].UsedPercent = &value
		}
		if window.WindowMinutes != nil {
			value := *window.WindowMinutes
			cloned.Windows[i].WindowMinutes = &value
		}
		if window.ResetsAt != nil {
			value := *window.ResetsAt
			cloned.Windows[i].ResetsAt = &value
		}
	}
	return cloned
}
