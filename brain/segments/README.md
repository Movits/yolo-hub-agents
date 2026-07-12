# Pacotes de segmento

Esta pasta receberá conhecimento e fluxos reutilizáveis por vertical, sem misturar empresas.

Exemplos futuros:

- `dealership/`: estoque, test-drive, avaliação e financiamento;
- `clinic/`: especialidades, agenda, urgência aprovada e limites de saúde;
- `hospital/`: orientação institucional, encaminhamento e governança reforçada.

Um agente poderá declarar `extends: [shared, clinic]` no manifesto. A ordem de resolução futura será:

```text
políticas obrigatórias compartilhadas
-> pacote de segmento
-> conhecimento aprovado da empresa
```

Conteúdo empresarial nunca poderá sobrescrever políticas legais ou de segurança. Para saúde, dados de
pacientes, sintomas, prontuários e documentos pessoais não entram na brain.
