import { describe, expect, it } from "vite-plus/test";

import { expectConsistentOperation } from "../fixtures/images";

describe("remove alpha recipe", () => {
  it("produces equivalent dimensions across raster drivers", async () => {
    const results = await expectConsistentOperation({ type: "removeAlpha" });
    expect(results).toHaveLength(3);
  });
});
