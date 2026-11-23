import { Buffer } from "node:buffer";
// The worker-side proxy server under unit test. Resolved via a vitest alias (see
// vitest.config.mts) rather than a real path so that its worker-typed source
// isn't pulled into the node-side tsconfig, which excludes `src/workers/**`.
// tsc has no matching path mapping, hence the expected error below.
// @ts-expect-error resolved at runtime by a vitest alias; see vitest.config.mts
import { ProxyServer } from "@proxy-server-under-test";
import { stringify } from "devalue";
import { afterAll, beforeAll, describe, test, vi } from "vitest";
import {
	CoreBindings,
	CoreHeaders,
	ProxyAddresses,
	ProxyOps,
} from "../../../../src/workers/core/constants";

const SECRET = new Uint8Array(16);
const SECRET_HEX = Buffer.from(SECRET).toString("hex");

/** Stubs the `constructor.name` checks the proxy server uses to detect RPC objects. */
function named<T extends object>(value: T, name: string): T {
	Object.defineProperty(value, "constructor", { value: { name } });
	return value;
}

describe("ProxyServer", () => {
	// `crypto.subtle.timingSafeEqual()` is a workerd extension to Web Crypto
	beforeAll(() => {
		vi.stubGlobal("crypto", {
			subtle: {
				timingSafeEqual: (
					a: ArrayBuffer | Uint8Array,
					b: ArrayBuffer | Uint8Array
				) =>
					Buffer.compare(
						Buffer.from(a as ArrayBuffer),
						Buffer.from(b as ArrayBuffer)
					) === 0,
			},
		});
	});
	afterAll(() => {
		vi.unstubAllGlobals();
	});

	test("disposes the temporary RpcStub created to look up a method", async ({
		expect,
	}) => {
		let disposeCount = 0;
		const stub = Object.defineProperty(
			named(function () {}, "RpcStub"),
			Symbol.dispose,
			{
				value: () => disposeCount++,
			}
		);
		// `stub.ping` is a thenable `RpcProperty` that resolves to the method's stub
		const property = Object.assign(
			named(function () {}, "RpcProperty"),
			{
				then: (resolve: (value: unknown) => void) => resolve(stub),
			}
		);

		const server: {
			heap: Map<number, unknown>;
			fetch(request: Request): Promise<Response>;
		} = new ProxyServer(undefined, {
			[CoreBindings.DATA_PROXY_SECRET]: SECRET.buffer,
		});
		server.heap.set(ProxyAddresses.USER_START, { ping: property });

		// Encoded as `ProxyClient` sends it: `[Native, [address, name, isFunction]]`
		const target = {};
		const targetHeader = stringify(target, {
			Native: (value) =>
				value === target
					? [ProxyAddresses.USER_START, "Object", false]
					: undefined,
		});

		const res = await server.fetch(
			new Request("http://localhost/", {
				method: "POST",
				headers: {
					Host: "localhost",
					[CoreHeaders.OP_SECRET]: SECRET_HEX,
					[CoreHeaders.OP]: ProxyOps.GET,
					[CoreHeaders.OP_KEY]: "ping",
					[CoreHeaders.OP_TARGET]: targetHeader,
				},
			})
		);

		expect(res.status, await res.text()).toBe(204);
		expect(res.headers.get(CoreHeaders.OP_RESULT_TYPE)).toBe("Function");
		expect(disposeCount).toBe(1);
	});
});
