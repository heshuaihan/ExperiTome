# SPDX-License-Identifier: MIT
"""Small synthetic regression checks; no private research data required."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

import pandas as pd

from diann_filter import filter_report, read_report, validate_config
from diann_settings import extract


class FilterTests(unittest.TestCase):
    def setUp(self):
        self.cfg = {"schema_version": 1, "filters": [["Q.Value", "<", 0.01]]}
        self.df = pd.DataFrame({"Run": ["r1", "r1", "r2", "r2"],
            "Protein.Group": ["P1"] * 4, "Stripped.Sequence": ["AAA", "AAA", "BBB", "BBB"],
            "Q.Value": [0.001] * 4, "PG.MaxLFQ": [10.0, 10.0, 0.0, float("nan")]})

    def test_strict_boundaries_and_invalid_values(self):
        self.df["Q.Value"] = [0.01, None, "bad", float("inf")]
        result, summary, runs = filter_report(self.df, self.cfg)
        self.assertTrue(result.empty)
        self.assertEqual(summary["stages"][0]["missing_nonnumeric_or_nonfinite_in_incoming_rows"], 3)
        self.assertEqual(runs.output_rows.tolist(), [0, 0])

    def test_inclusive_operators_are_explicit(self):
        self.df["Q.Value"] = [0.01] * 4
        self.cfg["filters"][0][1] = "<="
        self.assertEqual(len(filter_report(self.df, self.cfg)[0]), 4)

    def test_distinct_scope_across_report_or_run(self):
        self.cfg.update(minimum_distinct_peptides=2, peptide_count_scope="protein_group")
        self.assertEqual(len(filter_report(self.df, self.cfg)[0]), 4)
        self.cfg["peptide_count_scope"] = "run_protein_group"
        self.assertTrue(filter_report(self.df, self.cfg)[0].empty)

    def test_charge_states_not_extra_peptides(self):
        self.df["Stripped.Sequence"] = ["AAA"] * 4
        self.cfg["minimum_distinct_peptides"] = 2
        self.assertTrue(filter_report(self.df, self.cfg)[0].empty)

    def test_missing_blank_peptides_not_counted(self):
        self.df["Stripped.Sequence"] = ["AAA", None, "", "  "]
        self.cfg["minimum_distinct_peptides"] = 2
        self.assertTrue(filter_report(self.df, self.cfg)[0].empty)

    def test_quality_filter_precedes_peptide_count(self):
        self.df["Q.Value"] = [0.001, 0.001, 0.02, 0.02]
        self.cfg["minimum_distinct_peptides"] = 2
        self.assertTrue(filter_report(self.df, self.cfg)[0].empty)

    def test_contaminant_any_member_and_literal_tag(self):
        self.df["Protein.Group"] = ["P1;cRAP-X", "cRAP-X", "A.B", "AxB"]
        self.cfg["exclude_protein_group_contains"] = ["cRAP", "A.B"]
        self.assertEqual(filter_report(self.df, self.cfg)[0]["Protein.Group"].tolist(), ["AxB"])

    def test_missing_column_fails_closed(self):
        with self.assertRaises(ValueError):
            filter_report(self.df.drop(columns="Q.Value"), self.cfg)

    def test_quantities_rows_and_missing_values_preserved(self):
        before = self.df.copy(deep=True)
        result, _, _ = filter_report(self.df, self.cfg)
        pd.testing.assert_frame_equal(result, before)
        pd.testing.assert_frame_equal(self.df, before)

    def test_bad_config_and_missing_id_fail(self):
        for key, value in [("filters", [["Q.Value", "!=", 0.01]]), ("minimum_distinct_peptides", -1), ("typo", True)]:
            cfg = copy.deepcopy(self.cfg); cfg[key] = value
            with self.assertRaises(ValueError): validate_config(cfg)
        self.df.loc[0, "Run"] = None
        with self.assertRaises(ValueError): filter_report(self.df, self.cfg)

    def test_identifier_na_literal_preserved_in_csv(self):
        with tempfile.NamedTemporaryFile(dir=Path.cwd(), suffix=".csv", delete=False) as temp:
            path = Path(temp.name)
        try:
            path.write_text("Run,Protein.Group,Q.Value\nNA,NULL,0.001\n", encoding="utf-8")
            result = read_report(path)
            self.assertEqual(result.loc[0, "Run"], "NA")
            self.assertEqual(result.loc[0, "Protein.Group"], "NULL")
        finally:
            path.unlink()


class SettingsTests(unittest.TestCase):
    def test_windows_paths_repeated_flags_and_no_norm(self):
        record = extract('DIA-NN 2.6.0 Academia\ndiann.exe --f D:\\my data\\a.d --f D:\\my data\\b.d --var-mod A --var-mod B --rt-profiling --no-norm --reanalyse\n')
        self.assertEqual(record["explicit_flags"]["f"][0], r"D:\my data\a.d")
        self.assertEqual(record["input_file_count"], 2)
        self.assertEqual(record["explicit_flags"]["var-mod"], ["A", "B"])
        self.assertIn("disabled", record["normalization"])
        self.assertIn("not intensity", record["rt_profiling"])

    def test_absent_flag_does_not_prove_default(self):
        self.assertIn("not inferred", extract("diann.exe --qvalue 0.01\n")["normalization"])

    def test_missing_command_requires_manual_record(self):
        with self.assertRaises(ValueError): extract("normalisation disabled\n")


if __name__ == "__main__":
    unittest.main()
