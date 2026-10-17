import { describe, expect, it } from "vite-plus/test";

import { expectConsistentOperation } from "../fixtures/images";

describe("extend recipe", () => {
  it("produces equivalent dimensions across raster drivers", async () => {
    const results = await expectConsistentOperation(
      { type: "extend", top: 1, right: 1, bottom: 1, left: 1, background: "#3366cc" },
      { width: 10, height: 8 },
    );
    expect(results).toHaveLength(3);
  });
});
