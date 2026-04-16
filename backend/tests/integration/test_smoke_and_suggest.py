import pytest


@pytest.mark.asyncio
async def test_health(client):
    r = await client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_dashboard_init(client):
    r = await client.get("/api/v1/dashboard/init", params={"server_name": "TestServer"})
    assert r.status_code == 200
    data = r.json()
    assert data["server"]["name"] == "TestServer"
    assert "other_servers" in data


@pytest.mark.asyncio
async def test_simple_items_suggest(client):
    r = await client.get(
        "/api/v1/dashboard/simple_items/suggest",
        params={"server_name": "TestServer", "q": "mie", "limit": 10},
    )
    assert r.status_code == 200
    names = [x["name"] for x in r.json()]
    assert any("Miecz" in n for n in names)


@pytest.mark.asyncio
async def test_bonus_items_suggest(client):
    r = await client.get(
        "/api/v1/dashboard/bonus_items/suggest",
        params={"server_name": "TestServer", "q": "koral", "limit": 10},
    )
    assert r.status_code == 200
    names = [x["name"] for x in r.json()]
    assert any("Koral" in n for n in names)


@pytest.mark.asyncio
async def test_bonus_types_suggest(client):
    r = await client.get(
        "/api/v1/dashboard/bonus_items/bonus-types/suggest",
        params={"server_name": "TestServer", "q": "si", "limit": 10},
    )
    assert r.status_code == 200
    data = r.json()
    assert "suggestions" in data
    assert any("si" in s.lower() for s in data["suggestions"])
