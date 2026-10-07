import { z } from 'zod';

export const CAMERA_SCENE_VERSION = 'camera-scene-v1' as const;
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, '颜色必须是 #RRGGBB');
const position = z.tuple([z.number().finite().min(-12).max(12), z.number().finite().min(-12).max(12), z.number().finite().min(-12).max(12)]);
const scale = z.tuple([z.number().finite().min(0.1).max(6), z.number().finite().min(0.1).max(6), z.number().finite().min(0.1).max(6)]);
export const cameraSceneSchema = z.object({
  version: z.literal(CAMERA_SCENE_VERSION),
  title: z.string().trim().min(1).max(80).refine(value => !/[<>\x00-\x1f]/.test(value), '标题不能包含标记或控制字符'),
  background: color,
  palette: z.array(color).min(1).max(6),
  objects: z.array(z.object({ id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/), primitive: z.enum(['cone', 'sphere', 'ring', 'star']), position, scale, count: z.number().int().min(20).max(1000), color }).strict()).min(1).max(12),
  snowCount: z.number().int().min(0).max(160),
  mappings: z.object({ openPalm: z.enum(['scatter', 'gather']), closedFist: z.enum(['scatter', 'gather']), palmX: z.enum(['rotate', 'none']) }).strict(),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.objects.map(object => object.id)).size !== value.objects.length) ctx.addIssue({ code: 'custom', path: ['objects'], message: '物体 ID 必须唯一' });
  if (value.objects.reduce((sum, object) => sum + object.count, value.snowCount) > 2400) ctx.addIssue({ code: 'custom', path: ['objects'], message: '总粒子数（包括雪花）最多 2400' });
  if (value.mappings.openPalm === value.mappings.closedFist) ctx.addIssue({ code: 'custom', path: ['mappings'], message: '张掌与握拳必须映射到不同状态' });
});
export type CameraSceneConfig = z.infer<typeof cameraSceneSchema>;
export const cameraSceneCodeSchema = z.object({ scene: cameraSceneSchema }).strict();
export interface CameraVerification {
  scope: 'scene-behavior-synthetic';
  boundedScenePassed: boolean;
  visionModelVerified: false;
  physicalCameraVerified: false;
  fullRequirementVerified: false;
  runtimeVersion: string;
  runtimeHash: string;
  limitations: string[];
}
