"""Local regression checks; never contact Google or create resources."""
import importlib.util
from pathlib import Path
import unittest
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
