# Pacotes de segmento

Esta pasta receberá conhecimento e fluxos reutilizáveis por vertical, sem misturar empresas.

Cada pacote fica em `segments/<segment-id>/` e possui um `segment.json` com versão, status e
`knowledgeRoots`. As notas usam o mesmo ID no campo `agent`. O publicador compõe `shared`, segmentos
na ordem declarada em `extends` e, por último, o conhecimento específico do agente.

```json
{
  "schemaVersion": "1.0",
  "version": "1.0.0",
  "id": "automotivo",
  "status": "prototype",
  "knowledgeRoots": ["knowledge"]
}
```

Exemplos futuros:

- `dealership/`: estoque, test-drive, avaliação e financiamento;
- `clinic/`: especialidades, agenda, urgência aprovada e limites de saúde;
- `hospital/`: orientação institucional, encaminhamento e governança reforçada.

Um agente pode declarar `extends: [shared, clinic]` no manifesto. A ordem de resolução é:

```text
políticas obrigatórias compartilhadas
-> pacote de segmento
-> conhecimento aprovado da empresa
```

Conteúdo empresarial nunca poderá sobrescrever políticas legais ou de segurança. Para saúde, dados de
pacientes, sintomas, prontuários e documentos pessoais não entram na brain.
