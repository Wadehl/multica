package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/multica-ai/multica/server/pkg/protocol"
)

const (
	grokBillingBaseEnv       = "GROK_CLI_CHAT_PROXY_BASE_URL"
	grokBillingBaseURL       = "https://cli-chat-proxy.grok.com/v1"
	grokBillingTimeout       = 10 * time.Second
	grokWeeklyWindowMinutes  = 7 * 24 * 60
	grokMonthlyWindowMinutes = 30 * 24 * 60
	grokAuthIssuer           = "https://auth.x.ai"
)

type grokAuthEntry struct {
	Key       string `json:"key"`
	UserID    string `json:"user_id"`
	ExpiresAt string `json:"expires_at"`
}

type grokAuthSession struct {
	AccessToken string
	UserID      string
}

type grokUsagePeriod struct {
	Type  string `json:"type"`
	Start string `json:"start"`
	End   string `json:"end"`
}

type grokMoneyValue struct {
	Val json.RawMessage `json:"val"`
}

type grokBillingConfig struct {
	CreditUsagePercent *float64         `json:"creditUsagePercent"`
	CurrentPeriod      *grokUsagePeriod `json:"currentPeriod"`
	BillingPeriodStart string           `json:"billingPeriodStart"`
	BillingPeriodEnd   string           `json:"billingPeriodEnd"`
	MonthlyLimit       *grokMoneyValue  `json:"monthlyLimit"`
	Used               *grokMoneyValue  `json:"used"`
	OnDemandCap        *grokMoneyValue  `json:"onDemandCap"`
	OnDemandUsed       *grokMoneyValue  `json:"onDemandUsed"`
	PrepaidBalance     *grokMoneyValue  `json:"prepaidBalance"`
}

type grokBillingResponse struct {
	Config *grokBillingConfig `json:"config"`
	grokBillingConfig
}

// FetchGrokPlanLimits 读取本机 Grok CLI 的 OAuth 会话并查询 billing 数据。
// access token 只在本地请求中使用，返回值不包含 token、用户标识或账号信息。
func FetchGrokPlanLimits(ctx context.Context, env map[string]string) (*protocol.PlanLimitsSnapshot, error) {
	session, err := readGrokAuthSession(env)
	if err != nil {
		return nil, err
	}

	credits, err := fetchGrokBilling(ctx, env, session, true)
	if err != nil {
		return nil, err
	}
	if config := resolveGrokBillingConfig(credits); config != nil {
		if window := grokWeeklyWindow(config); window != nil {
			return grokPlanLimitsSnapshot(window), nil
		}
		if window := grokMonthlyWindow(config); window != nil {
			return grokPlanLimitsSnapshot(window), nil
		}
		if !grokReportsUsage(config) {
			fallback, fallbackErr := fetchGrokBilling(ctx, env, session, false)
			if fallbackErr != nil {
				return nil, fallbackErr
			}
			if fallbackConfig := resolveGrokBillingConfig(fallback); fallbackConfig != nil {
				if window := grokMonthlyWindow(fallbackConfig); window != nil {
					return grokPlanLimitsSnapshot(window), nil
				}
			}
		}
	}
	return nil, fmt.Errorf("grok billing response did not include a usable quota window")
}

func grokEnvValue(env map[string]string, key string) string {
	if env != nil {
		if value, ok := env[key]; ok {
			return strings.TrimSpace(value)
		}
	}
	return strings.TrimSpace(os.Getenv(key))
}

func readGrokAuthSession(env map[string]string) (*grokAuthSession, error) {
	home := grokEnvValue(env, "GROK_HOME")
	if home == "" {
		userHome, err := os.UserHomeDir()
		if err != nil {
			return nil, fmt.Errorf("resolve Grok home: %w", err)
		}
		home = filepath.Join(userHome, ".grok")
	}

	data, err := os.ReadFile(filepath.Join(home, "auth.json"))
	if err != nil {
		return nil, fmt.Errorf("read Grok auth: %w", err)
	}
	var entries map[string]grokAuthEntry
	if err := json.Unmarshal(data, &entries); err != nil {
		return nil, fmt.Errorf("decode Grok auth: %w", err)
	}

	preferredSeen := false
	var preferred *grokAuthSession
	var fallback *grokAuthSession
	for issuer, entry := range entries {
		if strings.HasPrefix(issuer, grokAuthIssuer) {
			preferredSeen = true
			if entry.Key != "" && preferred == nil {
				preferred = &grokAuthSession{AccessToken: entry.Key, UserID: entry.UserID}
			}
			continue
		}
		if fallback == nil && entry.Key != "" {
			fallback = &grokAuthSession{AccessToken: entry.Key, UserID: entry.UserID}
		}
	}
	if preferred != nil {
		return preferred, nil
	}
	if !preferredSeen && fallback != nil {
		return fallback, nil
	}
	return nil, fmt.Errorf("Grok auth session is unavailable")
}

func fetchGrokBilling(ctx context.Context, env map[string]string, session *grokAuthSession, credits bool) (*grokBillingResponse, error) {
	base := grokEnvValue(env, grokBillingBaseEnv)
	if base == "" {
		base = grokBillingBaseURL
	}
	endpoint := strings.TrimRight(base, "/") + "/billing"
	if credits {
		endpoint += "?format=credits"
	}

	requestCtx, cancel := context.WithTimeout(ctx, grokBillingTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(requestCtx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("create Grok billing request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+session.AccessToken)
	req.Header.Set("X-XAI-Token-Auth", "xai-grok-cli")
	req.Header.Set("Accept", "application/json")
	if session.UserID != "" {
		req.Header.Set("x-userid", session.UserID)
	}

	response, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request Grok billing: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden {
		return nil, fmt.Errorf("Grok billing authorization failed (HTTP %d)", response.StatusCode)
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("Grok billing request failed (HTTP %d)", response.StatusCode)
	}

	var result grokBillingResponse
	decoder := json.NewDecoder(io.LimitReader(response.Body, 1<<20))
	if err := decoder.Decode(&result); err != nil {
		return nil, fmt.Errorf("decode Grok billing response: %w", err)
	}
	return &result, nil
}

func resolveGrokBillingConfig(response *grokBillingResponse) *grokBillingConfig {
	if response == nil {
		return nil
	}
	if response.Config != nil {
		return response.Config
	}
	config := response.grokBillingConfig
	if config.CreditUsagePercent == nil && config.CurrentPeriod == nil && config.MonthlyLimit == nil && config.Used == nil &&
		config.OnDemandCap == nil && config.OnDemandUsed == nil && config.PrepaidBalance == nil &&
		config.BillingPeriodStart == "" && config.BillingPeriodEnd == "" {
		return nil
	}
	return &config
}

func grokWeeklyWindow(config *grokBillingConfig) *protocol.PlanLimitWindow {
	if config == nil {
		return nil
	}
	percent := config.CreditUsagePercent
	if percent == nil {
		if config.CurrentPeriod == nil || config.CurrentPeriod.Type != "USAGE_PERIOD_TYPE_WEEKLY" ||
			!grokTimestampsMatch(config.CurrentPeriod.Start, config.BillingPeriodStart) ||
			!grokTimestampsMatch(config.CurrentPeriod.End, config.BillingPeriodEnd) ||
			grokEmitsExplicitZero(config) || grokMonthlyWindow(config) != nil {
			return nil
		}
		zero := float64(0)
		percent = &zero
	}
	if *percent < 0 || *percent > 100 {
		return nil
	}
	return grokPlanLimitWindow("weekly", *percent, config.CurrentPeriod, config.BillingPeriodEnd, grokWeeklyWindowMinutes)
}

func grokMonthlyWindow(config *grokBillingConfig) *protocol.PlanLimitWindow {
	if config == nil || config.MonthlyLimit == nil || config.Used == nil {
		return nil
	}
	limit, ok := grokMoneyNumber(config.MonthlyLimit)
	if !ok || limit <= 0 {
		return nil
	}
	used, ok := grokMoneyNumber(config.Used)
	if !ok {
		return nil
	}
	percent := used / limit * 100
	if percent < 0 {
		percent = 0
	}
	if percent > 100 {
		percent = 100
	}
	return grokPlanLimitWindow("monthly", percent, config.CurrentPeriod, config.BillingPeriodEnd, grokMonthlyWindowMinutes)
}

func grokPlanLimitWindow(name string, percent float64, period *grokUsagePeriod, fallbackReset string, minutes int64) *protocol.PlanLimitWindow {
	window := &protocol.PlanLimitWindow{Name: name, UsedPercent: &percent, WindowMinutes: &minutes}
	resetText := fallbackReset
	if period != nil && period.End != "" {
		resetText = period.End
	}
	if reset, err := time.Parse(time.RFC3339Nano, resetText); err == nil {
		value := reset.Unix()
		window.ResetsAt = &value
	}
	return window
}

func grokTimestampsMatch(left, right string) bool {
	if left == "" || right == "" {
		return false
	}
	leftTime, leftErr := time.Parse(time.RFC3339Nano, left)
	rightTime, rightErr := time.Parse(time.RFC3339Nano, right)
	return leftErr == nil && rightErr == nil && leftTime.Equal(rightTime)
}

func grokMoneyNumber(value *grokMoneyValue) (float64, bool) {
	if value == nil || len(value.Val) == 0 {
		return 0, false
	}
	var number float64
	if json.Unmarshal(value.Val, &number) == nil {
		return number, true
	}
	var text string
	if json.Unmarshal(value.Val, &text) != nil {
		return 0, false
	}
	parsed, err := strconv.ParseFloat(strings.TrimSpace(text), 64)
	if err != nil {
		return 0, false
	}
	return parsed, true
}

func grokEmitsExplicitZero(config *grokBillingConfig) bool {
	for _, value := range []*grokMoneyValue{config.OnDemandCap, config.OnDemandUsed, config.PrepaidBalance, config.MonthlyLimit, config.Used} {
		if number, ok := grokMoneyNumber(value); ok && number == 0 {
			return true
		}
	}
	return false
}

func grokReportsUsage(config *grokBillingConfig) bool {
	return grokEmitsExplicitZero(config) || grokMoneyPresent(config.OnDemandCap) || grokMoneyPresent(config.OnDemandUsed) ||
		grokMoneyPresent(config.PrepaidBalance) || grokMoneyPresent(config.MonthlyLimit) || grokMoneyPresent(config.Used)
}

func grokMoneyPresent(value *grokMoneyValue) bool {
	_, ok := grokMoneyNumber(value)
	return ok
}

func grokPlanLimitsSnapshot(window *protocol.PlanLimitWindow) *protocol.PlanLimitsSnapshot {
	status := protocol.PlanLimitsStatusAvailable
	if window.UsedPercent != nil && *window.UsedPercent >= 100 {
		status = protocol.PlanLimitsStatusExhausted
	}
	return &protocol.PlanLimitsSnapshot{
		Provider:   "grok",
		Status:     status,
		Windows:    []protocol.PlanLimitWindow{*window},
		ObservedAt: time.Now().Unix(),
	}
}
