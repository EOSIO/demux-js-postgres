BEGIN;

CREATE OR REPLACE FUNCTION cyanaudit.fn_get_is_enabled()
	RETURNS bool
	LANGUAGE plpgsql
	STABLE
AS $_$ 	
declare
    my_enabled              text;
begin
    my_enabled := current_setting( 'cyanaudit.enabled', true );

    if my_enabled = '0' or my_enabled = 'false' or my_enabled = 'f' then
        return false;
    end if;

    return true;
end
 $_$;

COMMIT;
