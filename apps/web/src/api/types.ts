export type LeadStage = "no_conversion" | "converted";

export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};
