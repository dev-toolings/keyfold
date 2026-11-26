package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/dop251/goja"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Code mode serves two tools instead of four: search describes the
// operations, execute runs JavaScript that calls them. One script can chain
// several operations and return only what the agent needs. The interpreter
// sees the kf object and console.log only: no file, network or process
// access, and no operation that returns a value, so neither can a script.

// executeTimeout bounds one script, the operations it calls included.
var executeTimeout = 30 * time.Second

// maxExecuteOutput caps the result and the logs, in bytes.
const maxExecuteOutput = 64 << 10

type apiFunction struct {
	Name        string `json:"name"`
	Signature   string `json:"signature"`
	Description string `json:"description"`
}

// api describes the functions of o that a script can call.
func (o ops) api() []apiFunction {
	fns := []apiFunction{{"kf.listItems", `kf.listItems(): {items: {name, kind, project?: string, environment?: "prod" | "preprod" | "local", created_at?, updated_at?}[], unreadable: string[], catalog_updated_at?: string}`, o.listDescription}}
	if o.health != nil {
		fns = append(fns, apiFunction{"kf.vaultHealth", "kf.vaultHealth(): {server: {api, items, blobs, blob_bytes, free_bytes, max_blob, totp, sessions, uptime_seconds}, vault: {stale, reused, short, weak, no_totp: string[]}, unreadable: string[]}", healthDescription})
	}
	return append(fns,
		apiFunction{"kf.generateItem", `kf.generateItem({name: string, kind?: "login" | "token" | "ssh-passphrase"}): {created, kind, pending?: boolean}`, o.generateDescription},
		apiFunction{"kf.importEnv", "kf.importEnv({source: string, keys?: string[]}): {source, keys: {key, item, status}[]} // project and environment come from the declared source", o.importDescription})
}

type searchInput struct {
	Query string `json:"query,omitempty" jsonschema:"words to look for in the names and descriptions; empty lists every function"`
}

type searchOutput struct {
	Functions []apiFunction `json:"functions"`
}

type executeInput struct {
	Code string `json:"code" jsonschema:"JavaScript, the body of an async function: return a value to get it back"`
}

type executeOutput struct {
	Result any      `json:"result"`
	Logs   []string `json:"logs"`
}

const executeDescription = "Run JavaScript in an isolated interpreter and return what it returns. The code is the body of an async function: `return` sends a JSON value back, `console.log` adds a line to logs. " +
	"Globals: kf, whose functions search describes (they are synchronous; await works too), and console. An operation that fails throws an Error the script can catch. " +
	"No file, network or process access, no require. A script stops after 30 seconds; the result and the logs are capped at 64 KiB. No function returns a secret value. "

func addCodeModeTools(s *mcp.Server, o ops) {
	mcp.AddTool(s, &mcp.Tool{
		Name:        "search",
		Description: "Describe the functions an execute script can call on the kf object: name, TypeScript-like signature, description. Search first, then execute.",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true},
	}, func(_ context.Context, _ *mcp.CallToolRequest, in searchInput) (*mcp.CallToolResult, searchOutput, error) {
		return nil, searchOutput{Functions: searchAPI(o, in.Query)}, nil
	})
	mcp.AddTool(s, &mcp.Tool{Name: "execute", Description: executeDescription + o.requirement},
		func(ctx context.Context, _ *mcp.CallToolRequest, in executeInput) (*mcp.CallToolResult, executeOutput, error) {
			out, err := execute(ctx, o, in.Code)
			return nil, out, err
		})
}

// searchAPI returns the functions of o matching any word of query.
func searchAPI(o ops, query string) []apiFunction {
	words := strings.Fields(strings.ToLower(query))
	found := []apiFunction{}
	for _, f := range o.api() {
		text := strings.ToLower(f.Name + " " + f.Signature + " " + f.Description)
		if len(words) == 0 || containsAny(text, words) {
			found = append(found, f)
		}
	}
	return found
}

func containsAny(text string, words []string) bool {
	for _, w := range words {
		if strings.Contains(text, w) {
			return true
		}
	}
	return false
}

// execute runs code in a fresh interpreter holding the kf operations.
func execute(ctx context.Context, o ops, code string) (executeOutput, error) {
	ctx, cancel := context.WithTimeout(ctx, executeTimeout)
	defer cancel()
	vm := goja.New()
	timer := time.AfterFunc(executeTimeout, func() { vm.Interrupt(fmt.Sprintf("the script ran for more than %s", executeTimeout)) })
	defer timer.Stop()

	out := executeOutput{Logs: []string{}}
	logged := 0
	stringify, _ := goja.AssertFunction(vm.Get("JSON").ToObject(vm).Get("stringify"))
	toJSON := func(v goja.Value) string {
		s, err := stringify(goja.Undefined(), v)
		if err != nil || goja.IsUndefined(s) {
			return v.String()
		}
		return s.String()
	}
	console := vm.NewObject()
	console.Set("log", func(call goja.FunctionCall) goja.Value {
		parts := make([]string, len(call.Arguments))
		for i, a := range call.Arguments {
			if s, ok := a.Export().(string); ok {
				parts[i] = s
			} else {
				parts[i] = toJSON(a)
			}
		}
		line := strings.Join(parts, " ")
		if logged += len(line) + 8; logged > maxExecuteOutput { // 8: a line's JSON quotes and comma, so empty lines count
			panic(vm.NewGoError(errors.New("logs are over 64 KiB: log less")))
		}
		out.Logs = append(out.Logs, line)
		return goja.Undefined()
	})
	vm.Set("console", console)

	kf := vm.NewObject()
	// The operations share the script's deadline: the interpreter cannot stop
	// a Go call, the context stops its HTTP and ssh calls.
	kf.Set("listItems", bind(vm, ctx, func(struct{}) (any, error) { return o.list(ctx) }))
	if o.health != nil {
		kf.Set("vaultHealth", bind(vm, ctx, func(struct{}) (any, error) { return o.health(ctx) }))
	}
	kf.Set("generateItem", bind(vm, ctx, func(in generateInput) (any, error) { return o.generate(ctx, in) }))
	kf.Set("importEnv", bind(vm, ctx, func(in importInput) (any, error) { return o.importEnv(ctx, in) }))
	vm.Set("kf", kf)

	v, err := vm.RunString("(async () => {\n" + code + "\n})()")
	if err != nil {
		return executeOutput{}, capError(err)
	}
	p, ok := v.Export().(*goja.Promise)
	if !ok {
		return executeOutput{}, errors.New("the script did not run as an async function")
	}
	switch p.State() {
	case goja.PromiseStateRejected:
		return executeOutput{}, capError(fmt.Errorf("the script threw: %s", p.Result().String()))
	case goja.PromiseStatePending:
		return executeOutput{}, errors.New("the script waits for something that never comes: kf functions are synchronous")
	}
	if !goja.IsUndefined(p.Result()) {
		result := toJSON(p.Result())
		if len(result) > maxExecuteOutput {
			return executeOutput{}, fmt.Errorf("the result is %d bytes, over 64 KiB: return less", len(result))
		}
		if err := json.Unmarshal([]byte(result), &out.Result); err != nil {
			return executeOutput{}, fmt.Errorf("the result is not JSON: %w", err)
		}
	}
	if size, _ := json.Marshal(out); len(size) > maxExecuteOutput {
		return executeOutput{}, fmt.Errorf("the output is %d bytes, over 64 KiB: return less", len(size))
	}
	return out, nil
}

// maxErrorText caps an error message: a script may throw any string.
const maxErrorText = 4 << 10

func capError(err error) error {
	if msg := err.Error(); len(msg) > maxErrorText {
		return fmt.Errorf("%s... (%d bytes cut)", msg[:maxErrorText], len(msg)-maxErrorText)
	}
	return err
}

// bind exposes op to the script: its argument, an object, is decoded into the
// operation's input; its result comes back as plain JSON data; its error is
// thrown.
func bind[In any](vm *goja.Runtime, ctx context.Context, op func(In) (any, error)) func(goja.FunctionCall) goja.Value {
	return func(call goja.FunctionCall) goja.Value {
		if err := ctx.Err(); err != nil {
			panic(vm.NewGoError(fmt.Errorf("the script ran for more than %s", executeTimeout)))
		}
		var in In
		if arg := call.Argument(0); !goja.IsUndefined(arg) && !goja.IsNull(arg) {
			raw, err := json.Marshal(arg.Export())
			if err == nil {
				err = json.Unmarshal(raw, &in)
			}
			if err != nil {
				panic(vm.NewGoError(fmt.Errorf("bad argument: %w", err)))
			}
		}
		res, err := op(in)
		if err != nil {
			panic(vm.NewGoError(err))
		}
		raw, err := json.Marshal(res)
		if err != nil {
			panic(vm.NewGoError(err))
		}
		var data any
		json.Unmarshal(raw, &data)
		return vm.ToValue(data)
	}
}
