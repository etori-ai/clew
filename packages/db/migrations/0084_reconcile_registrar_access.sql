-- Reconcile both sides of directory changes missed before relation-mapped SCIM groups triggered derivation.
-- Hold membership, mapping and grant writes until the repair and its audit rows commit together.
LOCK TABLE auth_group, auth_group_member, auth_group_relation, auth_access_grant IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
WITH members AS (
  SELECT DISTINCT m.person_id
  FROM auth_group_relation r
  JOIN auth_group g ON g.organisation_id = r.organisation_id AND g.external_id = r.group_external_id
  JOIN auth_group_member m ON m.group_id = g.id
  JOIN auth_person p ON p.id = m.person_id AND p.organisation_id = g.organisation_id
  WHERE r.relation = 'registrar'
), expected AS (
  SELECT grant_row.person_id, members.person_id IS NOT NULL AS registrar
  FROM auth_access_grant grant_row
  LEFT JOIN members USING (person_id)
), corrected AS (
  UPDATE auth_access_grant grant_row
  SET relations = CASE WHEN expected.registrar THEN grant_row.relations || '["registrar"]'::jsonb
                       ELSE grant_row.relations - 'registrar' END
  FROM expected
  WHERE expected.person_id = grant_row.person_id AND (grant_row.relations ? 'registrar') <> expected.registrar
  RETURNING grant_row.person_id, grant_row.relations
)
INSERT INTO audit (actor, action, subject, details)
SELECT 'system:migration', 'grant.registrar_reconciled', 'person:' || person_id, jsonb_build_object('relations', relations)
FROM corrected;
