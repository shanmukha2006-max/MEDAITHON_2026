-- BreatheGuard 0006: the patient's chosen body model for the 3D breathing view (female | male).
-- Chosen by the patient at registration or on the 3D view; never inferred from a name. Safe to re-run.
alter table public.profiles add column if not exists body_model text check (body_model in ('female', 'male'));

-- Copy the choice from sign-up metadata after the profile is created (fires after on_auth_user_created).
create or replace function public.apply_body_model() returns trigger
language plpgsql security definer set search_path = public as $$
declare bm text := lower(coalesce(new.raw_user_meta_data ->> 'body_model', ''));
begin
  if bm in ('female', 'male') then update public.profiles set body_model = bm where id = new.id; end if;
  return new;
end $$;
drop trigger if exists zz_apply_body_model on auth.users;
create trigger zz_apply_body_model after insert on auth.users for each row execute function public.apply_body_model();
notify pgrst, 'reload schema';
