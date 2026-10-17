import { describe, expect, it } from "vite-plus/test";

import { expectConsistentOperation } from "../fixtures/images";

describe("autoorient recipe", () => {
  it("produces equivalent dimensions across raster drivers", async () => {
    const results = await expectConsistentOperation(
      { type: "autoOrient" },
      {
        allowUnsupported: ["canvas"],
      },
    );
    expect(results).toHaveLength(2);
  });
});
