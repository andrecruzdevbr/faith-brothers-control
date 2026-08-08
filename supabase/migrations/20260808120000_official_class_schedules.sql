-- ================================================================
-- Faith Brothers — Official class schedules (single source of truth)
-- Additive. Evolves public.classes to day+time+modality slots.
-- Does NOT edit applied migrations. Soft-deactivates legacy free-text rows.
-- ================================================================

-- 1) New columns (nullable first for legacy rows)
ALTER TABLE public.classes
  ADD COLUMN IF NOT EXISTS day_of_week SMALLINT,
  ADD COLUMN IF NOT EXISTS start_time TIME,
  ADD COLUMN IF NOT EXISTS audience TEXT,
  ADD COLUMN IF NOT EXISTS level TEXT,
  ADD COLUMN IF NOT EXISTS modality TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.classes.day_of_week IS 'ISO weekday: 1=Segunda … 7=Domingo';
COMMENT ON COLUMN public.classes.start_time IS 'Local class start time';
COMMENT ON COLUMN public.classes.audience IS 'infantil | adulto | feminino';
COMMENT ON COLUMN public.classes.level IS 'iniciante | avancado | iniciante_avancado | null';
COMMENT ON COLUMN public.classes.modality IS 'gi | nogi';

-- Drop name uniqueness (same display name repeats across days/times)
ALTER TABLE public.classes DROP CONSTRAINT IF EXISTS classes_academy_id_name_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'classes_day_of_week_check'
  ) THEN
    ALTER TABLE public.classes
      ADD CONSTRAINT classes_day_of_week_check
      CHECK (day_of_week IS NULL OR (day_of_week BETWEEN 1 AND 7));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'classes_audience_check'
  ) THEN
    ALTER TABLE public.classes
      ADD CONSTRAINT classes_audience_check
      CHECK (audience IS NULL OR audience IN ('infantil', 'adulto', 'feminino'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'classes_level_check'
  ) THEN
    ALTER TABLE public.classes
      ADD CONSTRAINT classes_level_check
      CHECK (
        level IS NULL
        OR level IN ('iniciante', 'avancado', 'iniciante_avancado')
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'classes_modality_check'
  ) THEN
    ALTER TABLE public.classes
      ADD CONSTRAINT classes_modality_check
      CHECK (modality IS NULL OR modality IN ('gi', 'nogi'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_classes_official_slot
  ON public.classes (academy_id, day_of_week, start_time, audience, modality)
  WHERE active = TRUE
    AND day_of_week IS NOT NULL
    AND start_time IS NOT NULL
    AND audience IS NOT NULL
    AND modality IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_classes_academy_active_day
  ON public.classes (academy_id, active, day_of_week, start_time, sort_order);

UPDATE public.classes
SET active = FALSE,
    updated_at = now()
WHERE day_of_week IS NULL
  AND active = TRUE;

-- 2) Seed official Faith Brothers schedule (idempotent)
DO $$
DECLARE
  _academy UUID;
BEGIN
  SELECT id INTO _academy FROM public.academies WHERE slug = 'faith-brothers' LIMIT 1;
  IF _academy IS NULL THEN
    SELECT id INTO _academy FROM public.academies ORDER BY created_at ASC LIMIT 1;
  END IF;
  IF _academy IS NULL THEN
    RAISE NOTICE 'No academy found — skip official class seed';
    RETURN;
  END IF;

  DELETE FROM public.classes
  WHERE academy_id = _academy
    AND notes = 'official_v1';

  INSERT INTO public.classes (
    academy_id, name, schedule_days, schedule_time,
    day_of_week, start_time, audience, level, modality, notes, sort_order, active
  )
  SELECT _academy, v.name, v.schedule_days, v.schedule_time,
         v.dow, v.st::time, v.audience, v.level, v.modality, 'official_v1', v.sort_order, TRUE
  FROM (
    VALUES
      (1, '17:40', 'infantil', NULL::text, 'gi', 'Infantil', 'Segunda', '17:40', 10),
      (1, '18:45', 'infantil', NULL, 'gi', 'Infantil', 'Segunda', '18:45', 20),
      (1, '19:45', 'adulto', 'iniciante_avancado', 'gi', 'Adulto iniciante/avançado', 'Segunda', '19:45', 30),
      (1, '21:15', 'adulto', 'iniciante_avancado', 'gi', 'Adulto iniciante/avançado', 'Segunda', '21:15', 40),
      (2, '10:00', 'adulto', 'iniciante_avancado', 'gi', 'Adulto iniciante/avançado', 'Terça', '10:00', 10),
      (2, '13:30', 'adulto', 'iniciante_avancado', 'gi', 'Adulto iniciante/avançado', 'Terça', '13:30', 20),
      (2, '17:00', 'adulto', 'iniciante_avancado', 'gi', 'Adulto iniciante/avançado', 'Terça', '17:00', 30),
      (2, '18:00', 'feminino', NULL, 'gi', 'Feminino', 'Terça', '18:00', 40),
      (2, '19:00', 'adulto', 'iniciante_avancado', 'gi', 'Adulto iniciante/avançado', 'Terça', '19:00', 50),
      (3, '17:40', 'infantil', NULL, 'gi', 'Infantil', 'Quarta', '17:40', 10),
      (3, '18:45', 'infantil', NULL, 'gi', 'Infantil', 'Quarta', '18:45', 20),
      (3, '19:45', 'adulto', 'iniciante_avancado', 'nogi', 'Adulto iniciante/avançado', 'Quarta', '19:45', 30),
      (3, '21:15', 'adulto', 'iniciante_avancado', 'gi', 'Adulto iniciante/avançado', 'Quarta', '21:15', 40),
      (4, '10:00', 'adulto', 'iniciante_avancado', 'nogi', 'Adulto iniciante/avançado', 'Quinta', '10:00', 10),
      (4, '13:30', 'adulto', 'iniciante_avancado', 'gi', 'Adulto iniciante/avançado', 'Quinta', '13:30', 20),
      (4, '17:00', 'adulto', 'iniciante_avancado', 'gi', 'Adulto iniciante/avançado', 'Quinta', '17:00', 30),
      (4, '18:00', 'feminino', NULL, 'gi', 'Feminino', 'Quinta', '18:00', 40),
      (4, '19:00', 'adulto', 'iniciante_avancado', 'gi', 'Adulto iniciante/avançado', 'Quinta', '19:00', 50),
      (5, '10:00', 'adulto', 'iniciante_avancado', 'gi', 'Adulto iniciante/avançado', 'Sexta', '10:00', 10),
      (5, '17:40', 'infantil', NULL, 'gi', 'Infantil', 'Sexta', '17:40', 20),
      (5, '18:45', 'infantil', NULL, 'gi', 'Infantil', 'Sexta', '18:45', 30),
      (5, '19:45', 'adulto', 'iniciante_avancado', 'gi', 'Adulto iniciante/avançado', 'Sexta', '19:45', 40),
      (5, '21:15', 'adulto', 'iniciante_avancado', 'gi', 'Adulto iniciante/avançado', 'Sexta', '21:15', 50)
  ) AS v(dow, st, audience, level, modality, name, schedule_days, schedule_time, sort_order);
END $$;

-- 3) Public read RPC (cadastro / anon)
CREATE OR REPLACE FUNCTION public.get_public_class_schedules(_academy_id UUID DEFAULT NULL)
RETURNS TABLE (
  id UUID,
  academy_id UUID,
  name TEXT,
  day_of_week SMALLINT,
  start_time TIME,
  audience TEXT,
  level TEXT,
  modality TEXT,
  notes TEXT,
  sort_order INTEGER,
  active BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.academy_id,
    c.name,
    c.day_of_week,
    c.start_time,
    c.audience,
    c.level,
    c.modality,
    CASE WHEN c.notes = 'official_v1' THEN NULL ELSE c.notes END AS notes,
    c.sort_order,
    c.active
  FROM public.classes c
  WHERE c.active = TRUE
    AND c.day_of_week IS NOT NULL
    AND c.start_time IS NOT NULL
    AND (_academy_id IS NULL OR c.academy_id = _academy_id)
  ORDER BY c.day_of_week ASC, c.start_time ASC, c.sort_order ASC, c.name ASC;
$$;

REVOKE ALL ON FUNCTION public.get_public_class_schedules(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_class_schedules(UUID) TO anon, authenticated, service_role;

-- 4) RLS: academy_limited may manage class schedule (ops), not finance
DROP POLICY IF EXISTS "classes_admin" ON public.classes;
CREATE POLICY "classes_admin"
  ON public.classes FOR ALL TO authenticated
  USING (
    public.is_admin_only(academy_id)
    OR public.is_academy_limited_of(academy_id)
  )
  WITH CHECK (
    public.is_admin_only(academy_id)
    OR public.is_academy_limited_of(academy_id)
  );
