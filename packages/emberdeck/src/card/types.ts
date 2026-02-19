export type CardStatus =
  | 'draft'
  | 'accepted'
  | 'implementing'
  | 'implemented'
  | 'deprecated';

export interface CardRelation {
  type: string;
  target: string;
}

export interface CardFrontmatter {
  key: string;
  summary: string;
  status: CardStatus;
  tags?: string[];
  keywords?: string[];
  constraints?: unknown;
  relations?: CardRelation[];
}

export interface CardFile {
  frontmatter: CardFrontmatter;
  body: string;
  filePath?: string;
}
