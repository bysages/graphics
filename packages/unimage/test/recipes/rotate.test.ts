import { describe, expect, it } from "vite-plus/test";

import { expectConsistentOperation } from "../fixtures/images";

describe("rotate recipe", () => {
  it("produces equivalent dimensions across raster drivers", async () => {
    const results = await expectConsistentOperation(
      { type: "rotate", angle: 90 },
      { width: 6, height: 8 },
    );
    expect(results).toHaveLength(3);
  });
});
