-- Auth: criação automática de public.profiles no signup.
-- Quando um usuário é criado em auth.users, espelhamos um profile com o mesmo id.
-- name vem de raw_user_meta_data->>'name' (preenchido no signUp do front);
-- role default COTISTA, mas pode ser promovido a ADMIN via metadata no cadastro.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, name, role)
    VALUES (
        NEW.id,
        COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'name', ''), split_part(NEW.email, '@', 1)),
        COALESCE((NEW.raw_user_meta_data ->> 'role')::user_role, 'COTISTA')
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();
