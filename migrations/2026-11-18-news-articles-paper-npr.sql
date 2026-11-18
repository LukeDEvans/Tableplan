-- news_articles.paper: allow NPR, the free paper added in #239 (NEWS_FRONT_PAGE_DESIGN.md §9).
-- #239 said "no migration", but the 2026-10-06 table only allowed the four
-- subscription papers, so after the 2026-11-17 deploy every hourly feed run failed
-- on its NPR rows (nothing new reached News for ~14 h). Applied 2026-11-18 with
-- Luke's OK (schema_migrations 20261118170000).
alter table public.news_articles drop constraint news_articles_paper_check;
alter table public.news_articles add constraint news_articles_paper_check
  check (paper = any (array['nyt','economist','startribune','athletic','npr']));
