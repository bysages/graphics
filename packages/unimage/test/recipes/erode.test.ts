import { describe, expect, it } from "vite-plus/test";

import { expectConsistentOperation } from "../fixtures/images";

describe("erode recipe", () => {
  it("produces equivalent dimensions across raster drivers", async () => {
    const results = await expectConsistentOperation({ type: "erode", size: 1 });
    expect(results).toHaveLength(3);
  });
});
