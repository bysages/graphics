<template>
  <main class="page">
    <section class="page-section">
      <div class="page-shell">
        <Container size="full" padding>
          <PageHeader>
            <PageHeader.Heading>
              <PageHeader.Eyebrow>Graphics</PageHeader.Eyebrow>
              <PageHeader.Title>unimage playground</PageHeader.Title>
            </PageHeader.Heading>
            <PageHeader.Description>
              Lens provides the source image; drivers process and encode it locally in the browser.
            </PageHeader.Description>
          </PageHeader>

          <form class="workspace" @submit.prevent="applySettings">
            <Card.Root class="run-card">
              <Card.Header>
                <Card.Title>Run</Card.Title>
                <Card.Description
                  >Choose a source, driver, and output before applying.</Card.Description
                >
              </Card.Header>
              <Card.Content class="panel">
                <SegmentGroup
                  :model-value="driverMode"
                  label="Driver"
                  :items="driverItems"
                  @update:model-value="setDriverMode"
                />

                <SegmentGroup
                  :model-value="sourceMode"
                  label="Source"
                  :items="sourceItems"
                  @update:model-value="setSourceMode"
                />

                <Field.Root v-if="sourceMode === `url`">
                  <Field.Label>Image URL</Field.Label>
                  <Input
                    v-model="imageUrl"
                    type="url"
                    placeholder="https://images.unsplash.com/..."
                  />
                </Field.Root>

                <Button
                  v-if="sourceMode === `url`"
                  type="button"
                  variant="outline"
                  @click="processFromUrl"
                >
                  Load URL
                </Button>

                <FileUpload
                  v-else
                  label="Local image"
                  placeholder="Choose image"
                  :max-files="1"
                  accept="image/*"
                  @update:accepted-files="processLocalFiles"
                />

                <SegmentGroup v-model="format" label="Output format" :items="formatItems" />
                <Slider
                  v-model="quality"
                  label="Quality"
                  :min="1"
                  :max="100"
                  :step="1"
                  :disabled="!qualityEnabled"
                />

                <Button type="button" size="lg" @click="applySettings">
                  {{ busy ? "Processing…" : "Apply settings" }}
                </Button>
              </Card.Content>
              <Card.Footer>
                <Typography.Muted :class="{ error: isError }">{{ status }}</Typography.Muted>
              </Card.Footer>
            </Card.Root>

            <Card.Root class="operations-card">
              <Card.Header>
                <Card.Title>Operations</Card.Title>
                <Card.Description>Enabled operations run in the listed order.</Card.Description>
              </Card.Header>
              <Card.Content class="panel">
                <section class="operation-group">
                  <Typography.Label>Geometry</Typography.Label>
                  <Switch v-model="settings.autoOrient" label="Auto orient" />

                  <div class="operation">
                    <Switch v-model="settings.resizeEnabled" label="Resize" />
                    <div v-if="settings.resizeEnabled" class="control-grid">
                      <NumberInput
                        v-model="settings.resizeWidth"
                        label="Width"
                        :min="1"
                        :step="1"
                        placeholder="Auto"
                      />
                      <NumberInput
                        v-model="settings.resizeHeight"
                        label="Height"
                        :min="1"
                        :step="1"
                        placeholder="Auto"
                      />
                      <SegmentGroup
                        :model-value="settings.resizeFit"
                        label="Fit"
                        :items="fitItems"
                        @update:model-value="setResizeFit"
                      />
                      <Switch v-model="settings.withoutEnlargement" label="Without enlargement" />
                    </div>
                  </div>

                  <div class="operation">
                    <Switch v-model="settings.cropEnabled" label="Crop" />
                    <div v-if="settings.cropEnabled" class="control-grid">
                      <NumberInput v-model="settings.cropX" label="X" :min="0" :step="1" />
                      <NumberInput v-model="settings.cropY" label="Y" :min="0" :step="1" />
                      <NumberInput
                        v-model="settings.cropWidth"
                        label="Crop width"
                        :min="1"
                        :step="1"
                      />
                      <NumberInput
                        v-model="settings.cropHeight"
                        label="Crop height"
                        :min="1"
                        :step="1"
                      />
                    </div>
                  </div>

                  <div class="operation">
                    <Switch v-model="settings.rotateEnabled" label="Rotate" />
                    <NumberInput
                      v-if="settings.rotateEnabled"
                      v-model="settings.rotateAngle"
                      label="Angle"
                      :min="-360"
                      :max="360"
                      :step="1"
                    />
                  </div>

                  <div class="operation">
                    <Switch v-model="settings.flipEnabled" label="Flip" />
                    <SegmentGroup
                      v-if="settings.flipEnabled"
                      :model-value="settings.flipAxis"
                      label="Axis"
                      :items="flipItems"
                      @update:model-value="setFlipAxis"
                    />
                  </div>
                </section>

                <section class="operation-group">
                  <Typography.Label>Color and blur</Typography.Label>
                  <Switch v-model="settings.grayscale" label="Grayscale" />
                  <Switch v-model="settings.invert" label="Invert" />
                  <div class="operation">
                    <Switch v-model="settings.blurEnabled" label="Blur" />
                    <NumberInput
                      v-if="settings.blurEnabled"
                      v-model="settings.blurSigma"
                      label="Sigma"
                      :min="0"
                      :step="0.1"
                    />
                  </div>
                </section>
              </Card.Content>
            </Card.Root>

            <Card.Root class="preview-card">
              <Card.Header>
                <Card.Title>Preview</Card.Title>
                <Card.Description
                  >Source and processed result stay on this device.</Card.Description
                >
              </Card.Header>
              <Card.Content>
                <div class="images">
                  <figure>
                    <img v-if="sourceUrl" :src="sourceUrl" alt="Original source" />
                    <div v-else class="image-placeholder" aria-hidden="true" />
                    <figcaption>{{ sourceInfo }}</figcaption>
                  </figure>
                  <figure>
                    <img v-if="resultUrl" :src="resultUrl" alt="unimage result" />
                    <div v-else class="image-placeholder" aria-hidden="true" />
                    <figcaption>{{ resultInfo }}</figcaption>
                  </figure>
                </div>
              </Card.Content>
            </Card.Root>
          </form>
        </Container>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import {
  Button,
  Card,
  Container,
  Field,
  FileUpload,
  Input,
  NumberInput,
  PageHeader,
  SegmentGroup,
  Slider,
  Switch,
  Typography,
} from "@bysages/vue";
import { createImageManager } from "unimage";
import type { ImageOperation } from "unimage";
import { canvasDriver } from "unimage/drivers/canvas";
import { computed, onMounted, reactive, ref } from "vue";

const lensBase = "https://api.bysages.com";
const defaultImage = "https://images.unsplash.com/photo-1506744038136-46273834b3fb";

const driverMode = ref<"canvas" | "napi">("canvas");
const sourceMode = ref<"url" | "file">("url");
const imageUrl = ref(defaultImage);
const format = ref<"png" | "jpeg" | "webp" | "avif">("webp");
const quality = ref(82);
const qualityEnabled = computed(() => format.value !== "png" && format.value !== "gif");
const busy = ref(false);
const isError = ref(false);
const status = ref("Ready to load the first image.");
const sourceUrl = ref("");
const resultUrl = ref("");
const sourceInfo = ref("No source loaded");
const resultInfo = ref("No result yet");
const currentSource = ref<Blob | null>(null);
const currentSourceKind = ref<"lens" | "local">("lens");

const settings = reactive({
  autoOrient: true,
  resizeEnabled: true,
  resizeWidth: "800",
  resizeHeight: "",
  resizeFit: "contain",
  withoutEnlargement: true,
  cropEnabled: false,
  cropX: "0",
  cropY: "0",
  cropWidth: "100",
  cropHeight: "100",
  rotateEnabled: false,
  rotateAngle: "90",
  flipEnabled: false,
  flipAxis: "horizontal",
  grayscale: false,
  invert: false,
  blurEnabled: false,
  blurSigma: "2",
});

const driverItems = [
  { value: "canvas", label: "Canvas" },
  { value: "napi", label: "Napi WASI" },
];
const sourceItems = [
  { value: "url", label: "Lens URL" },
  { value: "file", label: "Local file" },
];

const fitItems = [
  { value: "contain", label: "Contain" },
  { value: "cover", label: "Cover" },
  { value: "fill", label: "Fill" },
];

const flipItems = [
  { value: "horizontal", label: "Horizontal" },
  { value: "vertical", label: "Vertical" },
];

const formatItems = [
  { value: "webp", label: "WebP" },
  { value: "jpeg", label: "JPEG" },
  { value: "png", label: "PNG" },
  { value: "avif", label: "AVIF" },
];

function lensImageUrl(src: string): string {
  return `${lensBase}/img/w_1600,c_fit,f_webp,q_82/${encodeURIComponent(src)}`;
}

function parseNumber(value: string, label: string, minimum: number, integer = false): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || (integer && !Number.isInteger(parsed))) {
    throw new Error(
      `${label} must be an integer at least ${minimum}.`.replace(
        "an integer",
        integer ? "an integer" : "a number",
      ),
    );
  }
  return parsed;
}

function optionalNumber(value: string, label: string): number | undefined {
  if (value.trim() === "") return undefined;
  return parseNumber(value, label, 1, true);
}

function buildOperations(): ImageOperation[] {
  const operations: ImageOperation[] = [];
  if (settings.autoOrient) operations.push({ type: "autoOrient" });

  if (settings.cropEnabled) {
    operations.push({
      type: "crop",
      x: parseNumber(settings.cropX, "Crop X", 0),
      y: parseNumber(settings.cropY, "Crop Y", 0),
      width: parseNumber(settings.cropWidth, "Crop width", 1, true),
      height: parseNumber(settings.cropHeight, "Crop height", 1, true),
    });
  }

  if (settings.resizeEnabled) {
    const width = optionalNumber(settings.resizeWidth, "Resize width");
    const height = optionalNumber(settings.resizeHeight, "Resize height");
    if (width === undefined && height === undefined) {
      throw new Error("Resize requires a width, height, or both.");
    }
    operations.push({
      type: "resize",
      width,
      height,
      fit: settings.resizeFit as "contain" | "cover" | "fill",
      withoutEnlargement: settings.withoutEnlargement,
    });
  }

  if (settings.rotateEnabled) {
    const angle = Number(settings.rotateAngle);
    if (!Number.isFinite(angle) || angle < -360 || angle > 360) {
      throw new Error("Rotate angle must be between -360 and 360.");
    }
    operations.push({ type: "rotate", angle });
  }

  if (settings.flipEnabled) {
    operations.push({
      type: "flip",
      axis: settings.flipAxis as "horizontal" | "vertical",
    });
  }

  if (settings.grayscale) operations.push({ type: "grayscale" });
  if (settings.invert) operations.push({ type: "invert" });

  if (settings.blurEnabled) {
    operations.push({
      type: "blur",
      sigma: parseNumber(settings.blurSigma, "Blur sigma", 0),
    });
  }

  return operations;
}

let napiWorker: Worker | undefined;
let napiRequestId = 0;

type NapiProcessed = {
  data: Uint8Array;
  mediaType: string;
  metadata: { width: number; height: number; byteLength: number };
};

function napiEngine(): Worker {
  napiWorker?.terminate();
  napiWorker = new Worker(new URL("./napi.worker.ts", import.meta.url), {
    type: "module",
  });
  return napiWorker;
}

function processWithNapi(
  source: Blob,
  operations: ImageOperation[],
  output: { format: string; quality?: number },
): Promise<NapiProcessed> {
  const worker = napiEngine();
  const id = ++napiRequestId;

  return new Promise<NapiProcessed>((resolve, reject) => {
    const cleanup = (): void => {
      worker.removeEventListener("message", message);
      worker.removeEventListener("messageerror", failure);
      worker.removeEventListener("error", failure);
    };
    const message = (event: MessageEvent): void => {
      const response = event.data as {
        id?: number;
        kind: "result" | "unsupported" | "error";
        data?: ArrayBuffer;
        mediaType?: string;
        metadata?: NapiProcessed["metadata"];
        message?: string;
      };
      if (response.id !== id) return;
      cleanup();
      if (response.kind === "result" && response.data && response.mediaType && response.metadata) {
        resolve({
          data: new Uint8Array(response.data),
          mediaType: response.mediaType,
          metadata: response.metadata,
        });
        return;
      }
      reject(new Error(response.message ?? "Napi WASI processing failed."));
    };
    const failure = (event: ErrorEvent): void => {
      cleanup();
      reject(new Error(event.message || "The Napi WASI worker failed to start."));
    };
    worker.addEventListener("message", message);
    worker.addEventListener("messageerror", failure);
    worker.addEventListener("error", failure);

    void source.arrayBuffer().then((buffer) => {
      worker.postMessage({ id, source: buffer, operations, output }, [buffer]);
    });
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function replaceImageUrl(reference: { value: string }, blob: Blob): Promise<void> {
  const nextUrl = URL.createObjectURL(blob);
  const image = new Image();
  image.src = nextUrl;

  try {
    await image.decode();
  } catch (error) {
    URL.revokeObjectURL(nextUrl);
    throw new Error("The image could not be displayed.", { cause: error });
  }

  if (reference.value.startsWith("blob:")) URL.revokeObjectURL(reference.value);
  reference.value = nextUrl;
}

function showStatus(message: string, error = false): void {
  status.value = message;
  isError.value = error;
}

function setDriverMode(value: string | null): void {
  const mode = value === "napi" ? "napi" : "canvas";
  if (driverMode.value === mode) return;
  driverMode.value = mode;
  showStatus(`${mode === "napi" ? "Napi WASI" : "Canvas"} selected. Apply settings to run.`);
}
function setSourceMode(value: string | null): void {
  sourceMode.value = value === "file" ? "file" : "url";
}

function setResizeFit(value: string | null): void {
  settings.resizeFit = value ?? "contain";
}

function setFlipAxis(value: string | null): void {
  settings.flipAxis = value === "vertical" ? "vertical" : "horizontal";
}

async function fetchSourceBlob(): Promise<Blob> {
  const safe = new URL(imageUrl.value);
  if (safe.protocol !== "https:" && safe.protocol !== "http:") {
    throw new Error("Use an HTTP(S) image URL.");
  }
  const response = await fetch(lensImageUrl(safe.toString()));
  if (!response.ok) throw new Error(`Lens returned ${response.status}.`);
  return await response.blob();
}

async function process(source: Blob | null, sourceKind: "lens" | "local"): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  const isFetch = sourceKind === "lens" && (!source || source.size === 0);
  const driverLabel = driverMode.value === "napi" ? "Napi WASI" : "Canvas";
  let stage = isFetch ? "Fetching source" : "Preparing source";

  try {
    showStatus(`${stage}…`);
    const operations = buildOperations();
    const sourceBlob = source && source.size > 0 ? source : await fetchSourceBlob();
    const output =
      format.value === "png" || format.value === "gif"
        ? { format: format.value, metadataPolicy: "strip" as const }
        : { format: format.value, quality: quality.value, metadataPolicy: "strip" as const };

    const startedAt = performance.now();
    let processed;
    if (driverMode.value === "napi") {
      stage = "Processing with Napi WASI";
      showStatus(`${stage}…`);
      processed = await processWithNapi(sourceBlob, operations, output);
    } else {
      const image = createImageManager({ driver: canvasDriver() });
      stage = `Checking ${driverLabel} support`;
      showStatus(`${stage}…`);
      const capability = await image.isConfigSupported({ output, operations });
      if (!capability.supported) {
        const missing = capability.missing
          .map((issue) => `${issue.section}/${issue.key}`)
          .join(", ");
        throw new Error(`The selected pipeline is unsupported: ${missing}.`);
      }

      stage = `Processing with ${driverLabel}`;
      showStatus(`${stage}…`);
      processed = await image.transform(sourceBlob, { operations, output });
    }

    currentSourceKind.value = sourceKind;
    if (currentSource.value !== sourceBlob) {
      currentSource.value = sourceBlob;
      await replaceImageUrl(sourceUrl, sourceBlob);
    }
    await replaceImageUrl(
      resultUrl,
      new Blob([processed.data.slice().buffer as ArrayBuffer], { type: processed.mediaType }),
    );
    sourceInfo.value =
      `${sourceKind === "lens" ? "Lens source" : "Local source"} · ` +
      `${formatBytes(sourceBlob.size)}`;
    resultInfo.value =
      `unimage · ${driverLabel} · ${processed.metadata.width}×${processed.metadata.height} · ` +
      `${format.value.toUpperCase()} · ${formatBytes(processed.data.byteLength)} · ` +
      `${Math.round(performance.now() - startedAt)}ms`;
    showStatus("Done.");
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown error";
    showStatus(`${stage} failed: ${reason}`, true);
  } finally {
    busy.value = false;
  }
}

function processLocalFiles(files: File[]): void {
  const file = files.at(-1);
  if (file) void process(file, "local");
}

function processFromUrl(): void {
  void process(null, "lens");
}

function applySettings(): void {
  void process(currentSource.value, currentSourceKind.value);
}

onMounted(() => void process(null, "lens"));
</script>
<style>
body {
  margin: 0;
}

.page {
  min-height: 100dvh;
  padding-block: var(--bs-space-10) var(--bs-space-16);
  background: var(--bs-color-surface-0);
  color: var(--bs-color-text-primary);
}

.page-section {
  container: page / inline-size;
}

.page-shell {
  max-inline-size: 88rem;
  margin-inline: auto;
}

.workspace {
  display: grid;
  grid-template-columns: minmax(300px, 360px) minmax(320px, 400px) minmax(0, 1fr);
  grid-template-areas: "operations run preview";
  gap: var(--bs-gap-lg);
  align-items: start;
  margin-block-start: var(--bs-margin-2xl);
}

.run-card {
  grid-area: run;
  position: sticky;
  top: var(--bs-space-6);
}

.operations-card {
  grid-area: operations;
  position: sticky;
  top: var(--bs-space-6);
  max-height: calc(100dvh - var(--bs-space-12));
  overflow: auto;
}

.preview-card {
  grid-area: preview;
}

.panel {
  display: grid;
  gap: var(--bs-gap-md);
}

.operation-group {
  display: grid;
  gap: var(--bs-gap-md);
}

.operation {
  display: grid;
  gap: var(--bs-gap-sm);
  padding-block-start: var(--bs-gap-sm);
  border-block-start: var(--bs-hairline) solid var(--bs-color-border);
}

.control-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--bs-gap-sm);
}

.control-grid > [data-scope="segment-group"],
.control-grid > [data-scope="switch"] {
  grid-column: 1 / -1;
}

.control-grid > [data-scope="segment-group"] > [data-part="item"] {
  flex: 1 1 0;
  justify-content: center;
  text-align: center;
}

.images {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--bs-gap-lg);
}

figure {
  min-inline-size: 0;
  margin: 0;
}

img,
.image-placeholder {
  display: block;
  inline-size: 100%;
  aspect-ratio: 4 / 3;
  border-radius: var(--bs-radius-sm);
  background: var(--bs-color-surface-inset);
  object-fit: contain;
}

figcaption {
  padding-block-start: var(--bs-gap-sm);
  color: var(--bs-color-text-secondary);
  font-size: var(--bs-font-size-sm);
}

.error {
  color: var(--bs-color-danger);
}

@container page (max-width: 1280px) {
  .workspace {
    grid-template-columns: minmax(280px, 340px) minmax(300px, 400px);
    grid-template-areas:
      "operations run"
      "preview preview";
  }
}

@container page (max-width: 960px) {
  .workspace,
  .images {
    grid-template-columns: 1fr;
    grid-template-areas:
      "run"
      "operations"
      "preview";
  }

  .run-card,
  .operations-card {
    position: static;
  }
}

@container page (max-width: 480px) {
  .control-grid {
    grid-template-columns: 1fr;
  }
}
</style>
