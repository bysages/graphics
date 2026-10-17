import { describe, expect, it } from "vite-plus/test";

import { expectConsistentOperation } from "../fixtures/images";

describe("clahe recipe", () => {
  it("produces equivalent dimensions across raster drivers", async () => {
    const results = await expectConsistentOperation({
      type: "clahe",
      width: 2,
      height: 2,
      maxSlope: 2,
    });
    expect(results).toHaveLength(3);
  });
});
