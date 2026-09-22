import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CANONICAL_FRESH_INSTALL_ORDER } from "./database-install-manifest.mjs";

export const PRELAUNCH_UX_BASELINE_COMMIT =
  "62be10d87552e2df64ca04abc0dd4af8f7360585";
export const PRELAUNCH_UX_FEATURE_COMMIT =
  "4479023ebcba910152ae217c7760520fd9da471a";

const baselineBlobIds = Object.freeze({
  "01_profiles": "a723d3e3b3d252fcd645711410a3f8ce76d067fe",
  "02_organisations": "4ae707aff21c76922da7f3f6aeb745d387505c44",
  "03_clubs": "24a8a7749ab900339f33bfd21066d7fba984a7ad",
  "04_seasons": "3a1509e14fc344f82c727facb7058bd5f20be7e9",
  "05_competitions": "30ba633193a0d65a47f057d3b4ee7a40ce5acfe9",
  "06_entries": "8699791282bc57d41d9a421539570a3ccdc51640",
  "07_divisions": "c7fff06d03c05791a66094bcc476f65d04b0a269",
  "08_scoring": "a2d91d037a039c112c1328135f6ca82064feaeb4",
  "09_club_operations": "03e452886adfa3bbf5b2ee7589c35ee745b4333a",
  "10_results": "d51bfd90058d94256276693ec780bb810ebced6c",
  "11_round_robin": "9b866808bc312f5df43d6ca991f3472c805af3e6",
  "12_series": "87d8cc7f32553dd6b365bbe5c7978e9e230b09e4",
  "13_averages": "1d6b277fccf6d040ba89feaac2756a7e3bb89b94",
  "14_shooting_details": "0586299530d47dca0d046cb75d48db8afc9441fc",
  "15_concurrent_shooting": "d09dab6ff1a49bd5a29f79d3bd4597f70c4f3458",
  "16_public_read_models": "a0278cf71f0b1d17080214b898ea713bf0e1231a",
  "17_shooter_analytics": "9c773260681c8542835a81f092fd61764e6f3daf",
  "18_security_and_integrity": "e44bd7eea2b4aa6e21dcb15060399e1f42ef984a",
});

function gitBlobId(content) {
  const body = Buffer.from(content, "utf8");
  return createHash("sha1")
    .update(`blob ${body.byteLength}\0`)
    .update(body)
    .digest("hex");
}

export async function loadPrelaunchUxHistoricalBaseline() {
  assert.deepEqual(
    Object.keys(baselineBlobIds),
    [...CANONICAL_FRESH_INSTALL_ORDER],
    "The historical baseline manifest must cover the complete canonical install order",
  );

  const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
  const temporaryRoot = await mkdtemp(join(tmpdir(), "rifle-leagues-prelaunch-ux-"));
  const temporaryDatabase = join(temporaryRoot, "database");
  const patchPath = fileURLToPath(
    new URL("../fixtures/2026-09-21_prelaunch-ux-baseline.patch", import.meta.url),
  );

  try {
    await mkdir(temporaryDatabase, { recursive: true });
    await Promise.all(CANONICAL_FRESH_INSTALL_ORDER.map(async (name) => {
      const current = await readFile(
        join(repositoryRoot, "database", `${name}.sql`),
        "utf8",
      );
      await writeFile(
        join(temporaryDatabase, `${name}.sql`),
        current.replaceAll("\r\n", "\n"),
        "utf8",
      );
    }));

    execFileSync(
      "git",
      ["apply", "--reverse", "--unsafe-paths", patchPath],
      { cwd: temporaryRoot, encoding: "utf8" },
    );

    const baseline = new Map();
    for (const name of CANONICAL_FRESH_INSTALL_ORDER) {
      const content = (await readFile(
        join(temporaryDatabase, `${name}.sql`),
        "utf8",
      )).replaceAll("\r\n", "\n");
      assert.equal(
        gitBlobId(content),
        baselineBlobIds[name],
        `${name}.sql does not reconstruct the immutable ${PRELAUNCH_UX_BASELINE_COMMIT} baseline`,
      );
      baseline.set(name, content);
    }
    return baseline;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
