ALTER TABLE public.region_levels ADD CONSTRAINT region_levels_key_key UNIQUE (key);
ALTER TABLE public.regions ADD CONSTRAINT regions_code_key UNIQUE (code);
