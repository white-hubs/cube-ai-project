/** JS 精算与 SQL 预评分共用的唯一权重来源（禁止两处手写魔数）。 */
export const LEXICAL_FIELD_WEIGHTS = {
  keywords_text: { exact: 4, term: 1.1 },
  text_content: { exact: 3.5, term: 0.8 },
  headers_text: { exact: 3.2, term: 0.9 },
  start_time: { exact: 3.2, term: 0.9 },
  end_time: { exact: 3.2, term: 0.9 },
  property_namespace: { exact: 3, term: 0.9 },
  heading_path: { exact: 2.8, term: 0.8 },
  sheet_name: { exact: 2.5, term: 0.7 },
  embedding_text: { exact: 2.2, term: 0.6 },
} as const;

export type LexicalScoreField = keyof typeof LEXICAL_FIELD_WEIGHTS;

export const LEXICAL_SCORE_FIELDS = Object.keys(LEXICAL_FIELD_WEIGHTS) as LexicalScoreField[];
