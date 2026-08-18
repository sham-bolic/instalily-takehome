import { PipelineDatabase } from "../../backend/pipeline-database.ts";

declare global {
  var pipelineDatabase: PipelineDatabase | undefined;
}

export function getDatabase(): PipelineDatabase {
  globalThis.pipelineDatabase ??= new PipelineDatabase();
  return globalThis.pipelineDatabase;
}
