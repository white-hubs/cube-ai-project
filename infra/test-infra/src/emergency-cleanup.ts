import { stopTrackedOllamaIfAny } from './ollama-container';
import { stopTrackedOtelCollectorIfAny } from './otel-collector';
import { stopTrackedNacosIfAny } from './nacos-stack';
import { stopTrackedTestcontainersIfAny } from './stack';

/** 中断 / 异常退出时停掉 test-infra 跟踪到的全部 Testcontainer（MySQL/Redis/Qdrant/Nacos/Ollama/OTel）。 */
export async function stopAllTrackedTestinfra(): Promise<void> {
  await stopTrackedTestcontainersIfAny();
  await stopTrackedNacosIfAny();
  await stopTrackedOllamaIfAny();
  await stopTrackedOtelCollectorIfAny();
}
