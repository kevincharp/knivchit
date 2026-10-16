import { decideCallAppOutcome, UNAVAILABLE_MESSAGE } from "../lib/callAppRetry.js";

// Corre con `gjs -m extension/tests/callAppRetry.test.js` (no necesita bus).

const fail = (msg) => {
	printerr(`FAIL: ${msg}`);
	imports.system.exit(1);
};

const cases = [
	[1, false, { action: "done" }],
	[2, false, { action: "done" }],
	[1, true, { action: "retry", delayMs: 1500 }],
	[2, true, { action: "notify", message: UNAVAILABLE_MESSAGE }],
];

for (const [attempt, failed, expected] of cases) {
	const got = decideCallAppOutcome(attempt, failed);
	if (JSON.stringify(got) !== JSON.stringify(expected)) {
		fail(
			`decideCallAppOutcome(${attempt}, ${failed}) = ${JSON.stringify(got)}, esperaba ${JSON.stringify(expected)}`,
		);
	}
}

print("PASS: decideCallAppOutcome reintenta una vez a los 1500ms y avisa si la segunda falla también");
