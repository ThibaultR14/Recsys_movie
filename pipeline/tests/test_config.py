import config


def test_paths_are_inside_repo():
    assert config.RAW.parent == config.DATA_DIR
    assert config.WEB_DATA == config.REPO_ROOT / "web" / "public" / "data"
    assert (config.REPO_ROOT / "CLAUDE.md").is_file()


def test_min_ratings():
    assert config.MIN_RATINGS == 20
