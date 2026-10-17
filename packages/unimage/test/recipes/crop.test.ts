import { describe, expect, it } from "vite-plus/test";

import { expectConsistentOperation } from "../fixtures/images";

describe("crop recipe", () => {
  it("produces equivalent dimensions across raster drivers", async () => {
    const results = await expectConsistentOperation(
      { type: "crop", x: 1, y: 1, width: 4, height: 3 },
      { width: 4, height: 3 },
    );
    expect(results).toHaveLength(3);
  });
});
