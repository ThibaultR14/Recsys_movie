import config


def test_paths_are_inside_repo():
    assert config.RAW.parent == config.DATA_DIR
    assert config.WEB_DATA == config.REPO_ROOT / "web" / "public" / "data"
    assert (config.REPO_ROOT / "CLAUDE.md").is_file()


def test_min_ratings():
    assert config.MIN_RATINGS == 20


def test_step2_constants():
    assert config.SEED == 42
    assert config.MIN_EVAL_USER_RATINGS == 10
    assert config.N_VAL_USERS == config.N_TEST_USERS == 10_000
    assert config.FOLDIN_NUM / config.FOLDIN_DEN == 0.8
    assert config.SPLIT_DIR.parent == config.PROCESSED
    assert config.RESULTS_DIR.parent == config.PROCESSED
