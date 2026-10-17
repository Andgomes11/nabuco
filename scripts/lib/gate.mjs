import { pendencias } from './criterios.mjs';
import { FASES_ATIVAS } from './constantes.mjs';

export function decidirGate({ estado, criterios, cmdTarefa }) {
  if (!FASES_ATIVAS.has(estado?.fase)) return { bloquear: false, pendencias: [] };
  const p = pendencias(criterios);
  const lista = p.length
    ? p.map(x => `- ${x.id}: ${x.motivo}`).join('\n')
    : '- todos os critérios passaram, mas a tarefa ainda não foi concluída';
  const motivo = [
    `[nabuco] A tarefa "${estado.slug}" está na fase "${estado.fase}" e o turno não pode terminar assim.`,
    lista,
    'Faça uma destas opções:',
    `1) rode os comandos de verificação, registre a evidência com \`${cmdTarefa} criterio --id <id> --status passou --evidencia="<saída>"\` e então \`${cmdTarefa} concluir\`;`,
    `2) se precisa de uma decisão do usuário, rode \`${cmdTarefa} fase aguardando_usuario --motivo="<pergunta>"\` e então pergunte.`,
  ].join('\n');
  return { bloquear: true, pendencias: p, motivo };
}
