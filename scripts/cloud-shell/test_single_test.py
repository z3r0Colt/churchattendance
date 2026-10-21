"""Local regression checks; never contact Google or create resources."""
import importlib.util
from pathlib import Path
import unittest
import json
import tempfile
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("single_test_setup", Path(__file__).with_name("single-test.py"))
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class ServiceEnableTests(unittest.TestCase):
    def test_every_service_is_enabled_once_in_bounded_explicit_project_batches(self):
        with patch.object(setup, "command") as command:
            setup.enable_services("foldkeeper-fixture")
        batches = [call.args[0] for call in command.call_args_list]
        self.assertGreater(len(batches), 1)
        services = []
        for args in batches:
            self.assertEqual(args[:3], ["gcloud", "services", "enable"])
            self.assertEqual(args[-3:], ["--project", "foldkeeper-fixture", "--quiet"])
            batch = args[3:-3]
            self.assertGreater(len(batch), 0)
            self.assertLessEqual(len(batch), 20)
            services.extend(batch)
        self.assertEqual(len(services), len(set(services)))
        self.assertEqual(len(services), 21)
        self.assertIn("compute.googleapis.com", services)
        self.assertIn("firestore.googleapis.com", services)

    def test_failure_stops_before_later_batches(self):
        with patch.object(setup, "command", side_effect=setup.SetupError("fixture permission failure")) as command:
            with self.assertRaises(setup.SetupError):
                setup.enable_services("foldkeeper-fixture")
        self.assertEqual(command.call_count, 1)


class EndpointDiscoveryTests(unittest.TestCase):
    def test_captures_endpoint_list_for_deployment_instead_of_printing_it(self):
        output = 'SDK diagnostic\nFOLDKEEPER_ENDPOINTS=["pwaManifest","getPublicBranding"]\n'
        with patch.object(setup, "command", side_effect=lambda args, **kwargs: output if kwargs.get("capture") else None) as command:
            names = setup.discover_endpoints(Path("/fictional/checkout"), {"GCLOUD_PROJECT": "fixture-project"})
        self.assertEqual(names, ["pwaManifest", "getPublicBranding"])
        self.assertEqual(command.call_args.kwargs["env"]["GCLOUD_PROJECT"], "fixture-project")

    def test_missing_discovery_output_stops_before_deployment(self):
        for output in [None, '', 'SDK diagnostic only', 'FOLDKEEPER_ENDPOINTS=[]', 'FOLDKEEPER_ENDPOINTS=["unsafe,name"]']:
            with self.subTest(output=output), patch.object(setup, "command", return_value=output):
                with self.assertRaises(setup.SetupError):
                    setup.discover_endpoints(Path("/fictional/checkout"), {})


class FunctionParameterTests(unittest.TestCase):
    def test_excluded_backup_parameters_are_explicitly_disabled_before_build(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "functions").mkdir()
            (root / "firebase.json").write_text(json.dumps({"hosting": {"target": "portal"}}))
            args = SimpleNamespace(project="fixture-project", release="a" * 40)
            config = {"firebase": {"apiKey": "fixture-key", "appId": "fixture-app", "authDomain": "fixture-project.firebaseapp.com"},
                      "bucket": "fixture-project.firebasestorage.app", "churchId": "testing-rpc",
                      "origin": "https://fixture-project.web.app", "siteKey": "fixture-site-key"}
            def stop_before_build(args, **kwargs):
                if args[:3] == ["gcloud", "auth", "application-default"]:
                    return "fixture-local-authorization"
                raise setup.SetupError("stop fixture before installation or deployment")
            with patch.dict(setup.os.environ, {}, clear=True), patch.object(setup, "command", side_effect=stop_before_build):
                with self.assertRaisesRegex(setup.SetupError, "stop fixture"):
                    setup.deploy(args, None, config, root)
            params = dict(line.split("=", 1) for line in (root / "functions/.env.fixture-project").read_text().splitlines())
            self.assertEqual(params["BACKUP_BUCKET"], "not-configured")
            self.assertEqual(params["BACKUP_SERVICE_ACCOUNT"], "not-configured@not-configured.iam.gserviceaccount.com")
            self.assertEqual(params["CHURCH_ID"], "testing-rpc")
            self.assertEqual(params["STAFF_AUTH_ORIGIN"], config["origin"])


class AgentIamTests(unittest.TestCase):
    def test_materializes_agents_before_grants_and_checks_event_delivery_roles(self):
        calls = []
        granted = []
        emails = {
            "cloudfunctions.googleapis.com": "service-123456@gcf-admin-robot.iam.gserviceaccount.com",
            "pubsub.googleapis.com": "service-123456@gcp-sa-pubsub.iam.gserviceaccount.com",
            "eventarc.googleapis.com": "service-123456@gcp-sa-eventarc.iam.gserviceaccount.com",
            "run.googleapis.com": "service-123456@serverless-robot-prod.iam.gserviceaccount.com",
            "cloudbuild.googleapis.com": "service-123456@gcp-sa-cloudbuild.iam.gserviceaccount.com",
            "artifactregistry.googleapis.com": "service-123456@gcp-sa-artifactregistry.iam.gserviceaccount.com",
        }
        def run(args, **kwargs):
            calls.append(args)
            self.assertIn("fixture-project", args)
            if "--service" in args:
                return emails[args[args.index("--service") + 1]]
            granted.append((args[args.index("--member") + 1], args[args.index("--role") + 1]))
        google = SimpleNamespace(api=lambda *a, **kw: {"bindings": [{"role": role, "members": [member]} for member, role in granted]})
        with patch.object(setup, "command", side_effect=run):
            setup.prepare_function_agents("fixture-project", "123456", google)
        self.assertTrue(all("--service" in args for args in calls[:2]))
        self.assertTrue(all("--service" not in args for args in calls[2:]))
        identity_services = [args[args.index("--service") + 1] for args in calls if "--service" in args]
        self.assertEqual(identity_services, ["pubsub.googleapis.com", "eventarc.googleapis.com"])
        self.assertFalse(any(role in ["roles/cloudbuild.serviceAgent", "roles/run.serviceAgent", "roles/cloudfunctions.serviceAgent", "roles/artifactregistry.serviceAgent"] for member, role in granted))
        self.assertIn(("serviceAccount:123456-compute@developer.gserviceaccount.com", "roles/run.invoker"), granted)
        self.assertIn(("serviceAccount:123456-compute@developer.gserviceaccount.com", "roles/eventarc.eventReceiver"), granted)
        self.assertIn(("serviceAccount:service-123456@gcp-sa-pubsub.iam.gserviceaccount.com", "roles/iam.serviceAccountTokenCreator"), granted)
        self.assertFalse(any(role in ["roles/editor", "roles/owner"] or member == "allUsers" for member, role in granted))

    def test_wrong_project_service_identity_does_not_receive_grants(self):
        with patch.object(setup, "command", return_value="service-999@gcp-sa-pubsub.iam.gserviceaccount.com") as command:
            with self.assertRaisesRegex(setup.SetupError, "Unexpected service identity"):
                setup.prepare_function_agents("fixture-project", "123456", None)
        self.assertEqual(command.call_count, 1)

    def test_unverified_policy_stops_deployment(self):
        def run(args, **kwargs):
            if "--service" in args:
                service = args[args.index("--service") + 1]
                suffix = {"cloudfunctions": "gcf-admin-robot", "pubsub": "gcp-sa-pubsub", "eventarc": "gcp-sa-eventarc",
                          "run": "serverless-robot-prod", "cloudbuild": "gcp-sa-cloudbuild", "artifactregistry": "gcp-sa-artifactregistry"}[service.split(".")[0]]
                return f"service-123456@{suffix}.iam.gserviceaccount.com"
        google = SimpleNamespace(api=lambda *a, **kw: {"bindings": []})
        with patch.object(setup, "command", side_effect=run):
            with self.assertRaisesRegex(setup.SetupError, "bindings did not verify"):
                setup.prepare_function_agents("fixture-project", "123456", google)


class ArtifactCleanupTests(unittest.TestCase):
    def test_existing_policy_is_preserved(self):
        google = SimpleNamespace(api=unittest.mock.Mock(return_value={"cleanupPolicies": {"existing": {"action": "KEEP"}}}))
        setup.prepare_artifact_cleanup("fixture-project", google)
        self.assertEqual(google.api.call_count, 1)

    def test_existing_empty_repository_gets_scoped_seven_day_policy(self):
        google = SimpleNamespace(api=unittest.mock.Mock(return_value={"format": "DOCKER"}))
        setup.prepare_artifact_cleanup("fixture-project", google)
        args = google.api.call_args.args
        self.assertEqual(args[0], "artifactregistry.googleapis.com")
        self.assertIn("projects/fixture-project/locations/us-central1/repositories/gcf-artifacts", args[1])
        self.assertEqual(args[2], "PATCH")
        self.assertFalse(args[3]["cleanupPolicyDryRun"])
        self.assertEqual(args[3]["cleanupPolicies"]["firebase-functions-cleanup"]["condition"]["olderThan"], "604800s")


class ResumeTests(unittest.TestCase):
    def test_validates_remote_project_and_build_before_reusing_saved_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            args = SimpleNamespace(project="fixture-project", church_name="Fictional RPC", admin_email="operator@example.test")
            config = {"projectId": args.project, "churchId": "testing-rpc", "churchName": args.church_name,
                      "adminEmail": args.admin_email, "origin": "https://fixture-project.web.app", "projectNumber": "123456"}
            setup.private_json(root / ".church-operator/single-test-config.json", config)
            for file in ["node_modules/.bin/firebase", "functions/lib/index.js", "packages/shared/lib/index.js",
                         "apps/portal/dist/index.html", "apps/portal/dist/staff/index.html"]:
                target = root / file
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("fixture")
            def api(host, path):
                if host == "cloudresourcemanager.googleapis.com":
                    return {"projectId": args.project, "projectNumber": "123456"}
                return {"fields": {key: {"stringValue": value} for key, value in
                                   {"projectId": args.project, "churchId": "testing-rpc", "environment": "staging"}.items()}}
            self.assertEqual(setup.resume_config(args, SimpleNamespace(api=api), root), config)
            args.project = "different-project"
            with self.assertRaisesRegex(setup.SetupError, "arguments do not match"):
                setup.resume_config(args, SimpleNamespace(api=api), root)


class ResumeDeploymentTests(unittest.TestCase):
    def test_resume_prepares_iam_before_functions_and_preserves_enrollment_link(self):
        from io import BytesIO
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "functions").mkdir()
            (root / "firebase.json").write_text(json.dumps({"hosting": {"target": "portal"}}))
            private = root / ".church-operator"
            private.mkdir()
            enrollment = private / "administrator-setup.txt"
            enrollment.write_text("private fixture link must remain unchanged")
            args = SimpleNamespace(project="fixture-project", release="a" * 40, resume_deployment=True)
            config = {"firebase": {"apiKey": "fixture-key", "appId": "fixture-app", "authDomain": "fixture-project.firebaseapp.com"},
                      "projectId": args.project, "projectNumber": "123456", "churchName": "Fictional RPC",
                      "bucket": "fixture-project.firebasestorage.app", "churchId": "testing-rpc",
                      "origin": "https://fixture-project.web.app", "siteKey": "fixture-site-key"}
            calls, sequence = [], []
            def run(command, **kwargs):
                calls.append(command)
                if "--only" in command:
                    sequence.append(command[command.index("--only") + 1])
                return ""
            def response(url, **kwargs):
                value = ({"release": args.release, "projectId": args.project, "churchId": config["churchId"], "origin": config["origin"]}
                         if url.endswith("release.json") else {"name": "Fictional RPC · Foldkeeper"})
                return BytesIO(json.dumps(value).encode())
            with patch.dict(setup.os.environ, {}, clear=True), patch.object(setup, "command", side_effect=run), \
                 patch.object(setup, "prepare_function_agents", side_effect=lambda *a: sequence.append("iam")), \
                 patch.object(setup, "prepare_artifact_cleanup", side_effect=lambda *a: sequence.append("cleanup")), \
                 patch.object(setup, "discover_endpoints", return_value=["pwaManifest", "getPublicBranding"]), \
                 patch.object(setup, "urlopen", side_effect=response):
                setup.deploy(args, None, config, root)
            self.assertEqual(enrollment.read_text(), "private fixture link must remain unchanged")
            self.assertFalse(any(command[0] == "npm" or (command[0] == "node" and "initialize.mjs" in " ".join(command)) for command in calls))
            self.assertLess(sequence.index("iam"), sequence.index("functions:pwaManifest,functions:getPublicBranding"))
            self.assertLess(sequence.index("cleanup"), sequence.index("functions:pwaManifest,functions:getPublicBranding"))
            self.assertEqual(sequence[-1], "hosting")
            self.assertFalse(any("--force" in command for command in calls))
