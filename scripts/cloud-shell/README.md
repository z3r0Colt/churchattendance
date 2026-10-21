# Disposable single-church Cloud Shell setup

`single-test.py` prepares and deploys a pinned single-church build in an explicitly selected empty staging project. It is not the planned multi-tenant provisioner or production acceptance. It uses local gcloud/ADC authorization; never paste credential tokens, keys or the generated administrator enrollment link into chat or tickets.

Run with `--project`, `--church-name`, `--admin-email` and a full `--release` commit. After a deployment interruption, `--resume-deployment` checks the existing source marker, saved project/church configuration, remote reservation and required build outputs, then reuses the build. It does not reinstall npm packages, recreate church defaults or regenerate the administrator password link. Firebase's deployment predeploy commands still compile the affected artifacts.

The setup materializes only the Pub/Sub and Eventarc service agents needed for event delivery and grants their corresponding service-agent roles in the selected project. It does not infer Cloud Build, Cloud Run, Cloud Functions or Artifact Registry service-agent identities from Service Usage identity creation; those services manage their own agents, and Cloud Build execution identities are not interchangeable with service agents. It also grants the Pub/Sub service agent Token Creator and the default Compute runtime Eventarc Event Receiver and Cloud Run Invoker, matching firebase-tools v15.34.0 `deploy/functions/checkIam.ts`. Principals must match the verified project number; unconditional bindings are read back and checked before deployment. Existing runtime database/Auth/build permissions, source-bucket object access and per-secret access remain project/resource scoped. No human Owner/Editor grant, public record access or MFA bypass is added.

A missing `gcf-artifacts` repository is created in `us-central1`. An empty cleanup configuration receives a seven-day build-image deletion policy so Firebase does not stop for a non-interactive artifact-retention prompt. Existing cleanup policies or an explicit cleanup opt-out are preserved. No blanket `firebase deploy --force` is used. Recovery endpoints are excluded and recovery parameters retain explicit disabled values; full backup/recovery acceptance and billing budget alerts remain separate.

Only `TEST DEPLOYMENT READY` follows the public release/manifest identity checks. Intermediate Firebase `Deploy complete` lines can refer only to rules or functions. Real-cloud IAM propagation, organization restrictions, deployment quotas and browser/MFA enrollment remain live checks; local regression tests do not prove those checks passed.

Run the local no-network regression suite with:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/cloud-shell -p 'test_*.py'
```
