// Run from the hosting repository AFTER Workers Paid is enabled. Review the diff and deploy.
import fs from 'node:fs';
const path = new URL('../wrangler.jsonc', import.meta.url);
const config = JSON.parse(fs.readFileSync(path, 'utf8'));
config.compatibility_date = '2026-10-05';
config.containers = [...(config.containers || []).filter(c => c.class_name !== 'PainterlySharp'), {
  class_name: 'PainterlySharp', scheduling_policy: 'durable_object',
  images: { base: { dockerfile: './sharp-backend/Dockerfile' } },
}];
config.durable_objects ??= { bindings: [] };
config.durable_objects.bindings = [...config.durable_objects.bindings.filter(b => !['PAINTERLY_SHARP','PAINTERLY_LOCAL'].includes(b.name)),
  {name:'PAINTERLY_SHARP',class_name:'PainterlySharp'}];
config.migrations ??= [];
if (!config.migrations.some(m => m.tag === 'painterly-sharp-v1')) {
  config.migrations.push({ tag:'painterly-sharp-v1', new_sqlite_classes:['PainterlySharp'] });
}
fs.writeFileSync(path, JSON.stringify(config,null,2)+'\n');
