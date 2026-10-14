<template>
  <main class="page">
    <section class="page-section">
      <div class="page-shell">
        <Container size="full" padding>
          <PageHeader>
            <PageHeader.Heading>
              <PageHeader.Eyebrow>Graphics</PageHeader.Eyebrow>
              <PageHeader.Title>unimage browser playground</PageHeader.Title>
            </PageHeader.Heading>
            <PageHeader.Description>
              Lens provides the source image; unimage performs decoding, operation composition, and
              encoding locally in the browser.
            </PageHeader.Description>
          </PageHeader>

          <div class="layout">
            <form class="sidebar" @submit.prevent="applySettings">
              <Card.Root>
                <Card.Header>
                  <Card.Title>Source</Card.Title>
                  <Card.Description>Choose a Lens URL or a local image.</Card.Description>
                </Card.Header>
                <Card.Content class="panel">
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

                  <FileUpload
                    v-else
                    label="Local image"
                    placeholder="Choose image"
                    :max-files="1"
                    accept="image/*"
                    :disabled="busy"
                    @update:accepted-files="processLocalFiles"
                  />

                  <Button
                    v-if="sourceMode === `url`"
                    type="button"
                    variant="outline"
                    :disabled="busy"
                    @click="processFromUrl"
                  >
                    Load URL
                  </Button>
                </Card.Content>
              </Card.Root>

              <Card.Root>
                <Card.Header>
                  <Card.Title>Operations</Card.Title>
                  <Card.Description>
                    Enabled operations are applied in the listed order.
                  </Card.Description>
                </Card.Header>
                <Card.Content class="panel">
                  <section class="operation-group">
                    <Typography.Label>Geometry</Typography.Label>
                    <Switch v-model="settings.autoOrient" label="Auto orient" :disabled="busy" />

                    <div class="operation">
                      <Switch v-model="settings.resizeEnabled" label="Resize" :disabled="busy" />
                      <div v-if="settings.resizeEnabled" class="control-grid">
                        <NumberInput
                          v-model="settings.resizeWidth"
                          label="Width"
                          :min="1"
                          :step="1"
                          placeholder="Auto"
                          :disabled="busy"
                        />
                        <NumberInput
                          v-model="settings.resizeHeight"
                          label="Height"
                          :min="1"
                          :step="1"
                          placeholder="Auto"
                          :disabled="busy"
                        />
                        <SegmentGroup
                          :model-value="settings.resizeFit"
                          label="Fit"
                          :items="fitItems"
                          :disabled="busy"
                          @update:model-value="setResizeFit"
                        />
                        <Switch
                          v-model="settings.withoutEnlargement"
                          label="Without enlargement"
                          :disabled="busy"
                        />
                      </div>
                    </div>

                    <div class="operation">
                      <Switch v-model="settings.cropEnabled" label="Crop" :disabled="busy" />
                      <div v-if="settings.cropEnabled" class="control-grid">
                        <NumberInput
                          v-model="settings.cropX"
                          label="X"
                          :min="0"
                          :step="1"
                          :disabled="busy"
                        />
                        <NumberInput
                          v-model="settings.cropY"
                          label="Y"
                          :min="0"
                          :step="1"
                          :disabled="busy"
                        />
                        <NumberInput
                          v-model="settings.cropWidth"
                          label="Crop width"
                          :min="1"
                          :step="1"
                          :disabled="busy"
                        />
                        <NumberInput
                          v-model="settings.cropHeight"
                          label="Crop height"
                          :min="1"
                          :step="1"
                          :disabled="busy"
                        />
                      </div>
                    </div>

                    <div class="operation">
                      <Switch v-model="settings.rotateEnabled" label="Rotate" :disabled="busy" />
                      <NumberInput
                        v-if="settings.rotateEnabled"
                        v-model="settings.rotateAngle"
                        label="Angle"
                        :min="-360"
                        :max="360"
                        :step="1"
                        :disabled="busy"
                      />
                    </div>

                    <div class="operation">
                      <Switch v-model="settings.flipEnabled" label="Flip" :disabled="busy" />
                      <SegmentGroup
                        v-if="settings.flipEnabled"
                        :model-value="settings.flipAxis"
                        label="Axis"
                        :items="flipItems"
                        :disabled="busy"
                        @update:model-value="setFlipAxis"
                      />
                    </div>
                  </section>

                  <section class="operation-group">
                    <Typography.Label>Color and blur</Typography.Label>
                    <Switch v-model="settings.grayscale" label="Grayscale" :disabled="busy" />
                    <Switch v-model="settings.invert" label="Invert" :disabled="busy" />
                    <div class="operation">
                      <Switch v-model="settings.blurEnabled" label="Blur" :disabled="busy" />
                      <NumberInput
                        v-if="settings.blurEnabled"
                        v-model="settings.blurSigma"
                        label="Sigma"
                        :min="0"
                        :step="0.1"
                        :disabled="busy"
                      />
                    </div>
                  </section>

                  <section class="operation-group">
                    <Typography.Label>Output</Typography.Label>
                    <SegmentGroup
                      v-model="format"
                      label="Format"
                      :items="formatItems"
                      :disabled="busy"
                    />
                    <Slider
                      v-model="quality"
                      label="Quality"
                      :min="1"
                      :max="100"
                      :step="1"
                      :disabled="busy || !qualityEnabled"
                    />
                    <Button type="submit" :disabled="busy">
                      {{ busy ? "Processing…" : "Apply settings" }}
                    </Button>
                  </section>
                </Card.Content>
              </Card.Root>
            </form>

            <Card.Root class="preview">
              <Card.Header>
                <Card.Title>Result preview</Card.Title>
                <Card.Description>Processing stays on this device.</Card.Description>
              </Card.Header>
              <Card.Content>
                <div class="images">
                  <figure>
                    <img :src="sourceUrl" alt="Original source" />
                    <figcaption>{{ sourceInfo }}</figcaption>
                  </figure>
                  <figure>
                    <img :src="resultUrl" alt="unimage result" />
                    <figcaption>{{ resultInfo }}</figcaption>
                  </figure>
                </div>
                <Typography.Muted class="status" :class="{ error: isError }">
                  {{ status }}
                </Typography.Muted>
              </Card.Content>
            </Card.Root>
          </div>
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
import { onMounted, reactive, ref } from "vue";

const lensBase = "https://api.bysages.com";
const defaultImage = "https://images.unsplash.com/photo-1506744038136-46273834b3fb";

const sourceMode = ref<"url" | "file">("url");
const imageUrl = ref(defaultImage);
const format = ref<"png" | "jpeg" | "webp" | "avif">("webp");
const quality = ref(82);
const qualityEnabled = computed(() => format.value !== "png" && format.value !== "gif");
const busy = ref(false);
const isError = ref(false);
const status = ref("Preparing the first image…");
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function setObjectUrl(current: string, blob: Blob): string {
  if (current.startsWith("blob:")) URL.revokeObjectURL(current);
  return URL.createObjectURL(blob);
}

function showStatus(message: string, error = false): void {
  status.value = message;
  isError.value = error;
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
  showStatus(isFetch ? "Fetching source…" : "Processing locally…");

  try {
    const operations = buildOperations();
    const sourceBlob = source && source.size > 0 ? source : await fetchSourceBlob();
    const image = createImageManager({ driver: canvasDriver() });
    const output =
      format.value === "png" || format.value === "gif"
        ? { format: format.value, metadataPolicy: "strip" as const }
        : { format: format.value, quality: quality.value, metadataPolicy: "strip" as const };
    const capability = await image.check({
      output,
      operations: [...new Set(operations.map((operation) => operation.type))],
    });
    if (!capability.supported) throw new Error(`This browser cannot run the selected pipeline.`);

    const startedAt = performance.now();
    const processed = await image.transform(sourceBlob, {
      operations,
      output,
    });

    currentSource.value = sourceBlob;
    currentSourceKind.value = sourceKind;
    sourceUrl.value = setObjectUrl(sourceUrl.value, sourceBlob);
    resultUrl.value = setObjectUrl(
      resultUrl.value,
      new Blob([processed.data.slice().buffer as ArrayBuffer], { type: processed.mediaType }),
    );
    sourceInfo.value =
      `${sourceKind === "lens" ? "Lens source" : "Local source"} · ` +
      `${formatBytes(sourceBlob.size)}`;
    resultInfo.value =
      `unimage ${processed.metadata.width}×${processed.metadata.height} · ` +
      `${format.value.toUpperCase()} · ${formatBytes(processed.data.byteLength)} · ` +
      `${Math.round(performance.now() - startedAt)}ms`;
    showStatus("Done.");
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "Processing failed.", true);
  } finally {
    busy.value = false;
  }
}

function processLocalFiles(files: File[]): void {
  const file = files.at(-1);
  if (file) void process(file, "local");
}

function processFromUrl(): void {
  currentSource.value = null;
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
  padding-block: var(--bs-space-12) var(--bs-space-16);
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

.layout {
  display: grid;
  grid-template-columns: minmax(320px, 400px) minmax(0, 1fr);
  gap: var(--bs-gap-xl);
  align-items: start;
  margin-block-start: var(--bs-margin-2xl);
}

.sidebar {
  display: grid;
  gap: var(--bs-gap-lg);
}

.panel {
  display: grid;
  gap: var(--bs-gap-lg);
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

.control-grid > [data-scope="segment-group"] {
  inline-size: 100%;
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

img {
  display: block;
  inline-size: 100%;
  max-block-size: 52vh;
  border-radius: var(--bs-radius-sm);
  background: var(--bs-color-surface-inset);
  object-fit: contain;
}

figcaption {
  padding-block-start: var(--bs-gap-sm);
  color: var(--bs-color-text-secondary);
  font-size: var(--bs-font-size-sm);
}

.status {
  margin-block-start: var(--bs-gap-lg);
}

.error {
  color: var(--bs-color-danger);
}

@container page (max-width: 900px) {
  .layout,
  .images {
    grid-template-columns: 1fr;
  }
}

@container page (max-width: 480px) {
  .control-grid {
    grid-template-columns: 1fr;
  }
}
</style>
