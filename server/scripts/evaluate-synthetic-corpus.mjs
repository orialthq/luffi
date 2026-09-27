import { evaluateSyntheticCorpus } from "../src/evaluation/synthetic_corpus.js";

const result = await evaluateSyntheticCorpus();
console.log(JSON.stringify(result, null, 2));
if (result.passing !== result.total || result.extraFiles.length) process.exitCode = 1;
