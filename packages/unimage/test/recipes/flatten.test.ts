import { describe, expect, it } from "vite-plus/test";

import { expectConsistentOperation } from "../fixtures/images";

describe("flatten recipe", () => {
  it("produces equivalent dimensions across raster drivers", async () => {
    const results = await expectConsistentOperation({ type: "flatten", background: "#3366cc" });
    expect(results).toHaveLength(3);
  });
});
