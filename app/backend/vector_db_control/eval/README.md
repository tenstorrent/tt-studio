# Retrieval eval

~30 question/keyword pairs over the internal knowledge corpus, scored as
hit-rate@k against the `/collections/retrieve` pipeline. Run it manually against
a running backend before/after retrieval changes:

```bash
python vector_db_control/eval/run_eval.py --base-url http://localhost:8000
```

`--configs full,dense,no-rerank` compares the full pipeline against ablations
(stages disabled via the endpoint's `disable_stages` debug field).
