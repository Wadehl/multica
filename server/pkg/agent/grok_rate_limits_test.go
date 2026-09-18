package agent

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/multica-ai/multica/server/pkg/protocol"
)

func TestGrokWeeklyWindow(t *testing.T) {
	config := &grokBillingConfig{
		CreditUsagePercent: float64Ptr(37),
		CurrentPeriod: &grokUsagePeriod{
			Type: "USAGE_PERIOD_TYPE_WEEKLY",
			End:  "2026-09-20T12:00:00Z",
		},
	}

	window := grokWeeklyWindow(config)
	if window == nil || window.UsedPercent == nil || *window.UsedPercent != 37 {
		t.Fatalf("weekly window = %+v", window)
	}
	if window.WindowMinutes == nil || *window.WindowMinutes != grokWeeklyWindowMinutes {
		t.Fatalf("weekly duration = %+v", window.WindowMinutes)
	}
	if window.ResetsAt == nil {
		t.Fatal("weekly reset time is missing")
	}
}

func TestGrokMonthlyWindowParsesStringMoneyValues(t *testing.T) {
	config := &grokBillingConfig{
		MonthlyLimit: &grokMoneyValue{Val: []byte(`"100"`)},
		Used:         &grokMoneyValue{Val: []byte(`"25"`)},
	}

	window := grokMonthlyWindow(config)
	if window == nil || window.UsedPercent == nil || *window.UsedPercent != 25 {
		t.Fatalf("monthly window = %+v", window)
	}
	if window.WindowMinutes == nil || *window.WindowMinutes != grokMonthlyWindowMinutes {
		t.Fatalf("monthly duration = %+v", window.WindowMinutes)
	}
}

func TestGrokWeeklyWindowDoesNotInventZeroUsage(t *testing.T) {
	config := &grokBillingConfig{
		CurrentPeriod: &grokUsagePeriod{
			Type:  "USAGE_PERIOD_TYPE_WEEKLY",
			Start: "2026-09-13T12:00:00Z",
			End:   "2026-09-20T12:00:00Z",
		},
		BillingPeriodStart: "2026-09-13T12:00:00Z",
		BillingPeriodEnd:   "2026-09-20T12:00:00Z",
		OnDemandUsed:       &grokMoneyValue{Val: []byte(`0`)},
	}

	if window := grokWeeklyWindow(config); window != nil {
		t.Fatalf("weekly window inferred without a usage percentage: %+v", window)
	}
}

func TestReadGrokAuthSessionPrefersXAIIssuer(t *testing.T) {
	home := t.TempDir()
	auth := `{
  "https://other.example": {"key":"fallback-token","user_id":"fallback"},
  "https://auth.x.ai": {"key":"preferred-token","user_id":"preferred"}
}`
	if err := os.WriteFile(filepath.Join(home, "auth.json"), []byte(auth), 0o600); err != nil {
		t.Fatal(err)
	}

	session, err := readGrokAuthSession(map[string]string{"GROK_HOME": home})
	if err != nil {
		t.Fatal(err)
	}
	if session.AccessToken != "preferred-token" || session.UserID != "preferred" {
		t.Fatalf("session = %+v", session)
	}
}

func TestGrokPlanLimitsSnapshotMarksExhaustedWindow(t *testing.T) {
	used := 100.0
	snapshot := grokPlanLimitsSnapshot(&protocol.PlanLimitWindow{Name: "weekly", UsedPercent: &used})
	if snapshot.Status != protocol.PlanLimitsStatusExhausted || snapshot.Provider != "grok" {
		t.Fatalf("snapshot = %+v", snapshot)
	}
}

func float64Ptr(value float64) *float64 {
	return &value
}
