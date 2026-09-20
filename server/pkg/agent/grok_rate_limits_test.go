package agent

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
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
  "https://auth.x.ai::account": {"key":"preferred-token","user_id":"preferred","refresh_token":"refresh","oidc_client_id":"client"}
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

func TestReadGrokAuthSessionRejectsLookalikeIssuer(t *testing.T) {
	home := t.TempDir()
	auth := `{"https://auth.x.ai.evil":{"key":"unrelated-token"}}`
	if err := os.WriteFile(filepath.Join(home, "auth.json"), []byte(auth), 0o600); err != nil {
		t.Fatal(err)
	}

	if _, err := readGrokAuthSession(map[string]string{"GROK_HOME": home}); err == nil {
		t.Fatal("expected a lookalike issuer to be rejected")
	}
}

func TestRefreshGrokAuthSessionUsesDaemonSideOIDCRefresh(t *testing.T) {
	home := t.TempDir()
	authPath := filepath.Join(home, "auth.json")
	if err := os.WriteFile(authPath, []byte(`{
  "https://auth.x.ai::account": {
    "key": "old-token",
    "user_id": "user",
    "refresh_token": "old-refresh",
    "oidc_client_id": "client"
  }
}`), 0o600); err != nil {
		t.Fatal(err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.Header.Get("Content-Type") != "application/x-www-form-urlencoded" {
			t.Fatalf("unexpected refresh request: %s %s", r.Method, r.Header.Get("Content-Type"))
		}
		if err := r.ParseForm(); err != nil {
			t.Fatal(err)
		}
		if r.Form.Get("grant_type") != "refresh_token" || r.Form.Get("refresh_token") != "old-refresh" || r.Form.Get("client_id") != "client" {
			t.Fatalf("unexpected refresh form: %v", r.Form)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"new-token","refresh_token":"new-refresh","expires_in":3600}`))
	}))
	defer server.Close()

	env := map[string]string{"GROK_HOME": home, grokOIDCTokenEndpointEnv: server.URL}
	session, err := readGrokAuthSession(env)
	if err != nil {
		t.Fatal(err)
	}
	if err := refreshGrokAuthSession(context.Background(), env, session); err != nil {
		t.Fatal(err)
	}
	if session.AccessToken != "new-token" || session.RefreshToken != "new-refresh" {
		t.Fatalf("refreshed session = %+v", session)
	}
	persisted, err := os.ReadFile(authPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(persisted), `"key": "new-token"`) || !strings.Contains(string(persisted), `"refresh_token": "new-refresh"`) {
		t.Fatalf("auth file was not updated: %s", persisted)
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
