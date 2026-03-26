-- Add configurable minimum score threshold per segment
ALTER TABLE segments
ADD COLUMN min_score_threshold integer NOT NULL DEFAULT 70;

-- Validate range 0-100
ALTER TABLE segments
ADD CONSTRAINT segments_min_score_threshold_range
CHECK (min_score_threshold >= 0 AND min_score_threshold <= 100);
