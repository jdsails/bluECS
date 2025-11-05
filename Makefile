ENC_DIR := data/*/ENC_ROOT
TILES_DIR := src/tiles
ENC := $(wildcard $(ENC_DIR)/*.000)
TILES := $(ENC:$(ENC_DIR)/%.000=$(TILES_DIR)/%.pmtiles)
TILEJSON := $(ENC:$(ENC_DIR)/%.000=$(TILES_DIR)/%.json)

.PHONY: all clean data tiles jsons $(TILES_DIR)

all: jsons $(TILES_DIR)/catalog.json

$(TILES_DIR):
	@mkdir -p $(TILES_DIR)
	@mkdir -p $(TILES_DIR)/folio/

data:
	@mkdir -p data
	@echo "Copying local data..."
	cp /Users/jamesdavies/Documents/3-IT-and-Computing/gitrepo/rya_bluECS/RYACharts.zip data/RYACharts.zip
	@echo "Extracting ENC data..."
	unzip -o data/RYACharts.zip -d data

tiles: | $(TILES_DIR)
	@for encfile in $(ENC); do \
		base=$$(basename $$encfile .000); \
		echo "Converting $$encfile to $(TILES_DIR)/folio/$$base.pmtiles"; \
		bin/s57-to-tiles $$encfile $(TILES_DIR)/folio/$$base.pmtiles; \
	done

jsons: tiles | $(TILES_DIR)
	@for pmfile in $(TILES_DIR)/folio/*.pmtiles; do \
		base=$$(basename $$pmfile .pmtiles); \
		echo "Creating tilejson for $$pmfile"; \
		pmtiles show --tilejson $$pmfile > $(TILES_DIR)/folio/$$base.json; \
	done

FOLIOTILES := $(wildcard $(TILES_DIR)/folio/*.pmtiles)

superchart: $(TILES_DIR)/all-charts.pmtiles

$(TILES_DIR)/all-charts.pmtiles: $(FOLIOTILES) | $(TILES_DIR)/folio
	# Increase file descriptor limit for tile-join
	ulimit -n 100000; \
	tile-join --force --no-tile-size-limit --overzoom -o $@ $(FOLIOTILES)

clean:
	rm -rf $(TILES_DIR)

$(TILES_DIR)/catalog.json: jsons | $(TILES_DIR)
	@rm -f $(TILES_DIR)/catalog.json
	bin/catalog $(TILES_DIR)/*.json > $@
