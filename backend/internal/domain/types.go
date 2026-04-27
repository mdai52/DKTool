package domain

type ModeSummary struct {
	Slug        string `json:"slug"`
	Name        string `json:"name"`
	Subtitle    string `json:"subtitle"`
	Description string `json:"description"`
	Accent      string `json:"accent"`
}

type MapSummary struct {
	Slug           string `json:"slug"`
	Name           string `json:"name"`
	Caption        string `json:"caption"`
	Description    string `json:"description"`
	Theme          string `json:"theme"`
	DefaultVariant string `json:"defaultVariant"`
	DefaultFloor   string `json:"defaultFloor"`
}

type Variant struct {
	Slug        string `json:"slug"`
	Label       string `json:"label"`
	Description string `json:"description"`
}

type Floor struct {
	Slug string `json:"slug"`
	Name string `json:"name"`
}

type RandomEvent struct {
	Slug           string `json:"slug"`
	Name           string `json:"name"`
	Summary        string `json:"summary"`
	Hint           string `json:"hint"`
	HighlightColor string `json:"highlightColor"`
	FocusRegion    string `json:"focusRegion"`
}

type Region struct {
	Name  string  `json:"name"`
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	Floor string  `json:"floor"`
}

type Layer struct {
	Slug    string `json:"slug"`
	Name    string `json:"name"`
	Icon    string `json:"icon"`
	Color   string `json:"color"`
	Count   int    `json:"count"`
	Enabled bool   `json:"enabled"`
}

type LayerGroup struct {
	Slug   string  `json:"slug"`
	Name   string  `json:"name"`
	Layers []Layer `json:"layers"`
}

type Point struct {
	ID          int64    `json:"id"`
	Name        string   `json:"name"`
	LayerSlug   string   `json:"layerSlug"`
	RegionName  string   `json:"regionName"`
	Floor       string   `json:"floor"`
	EventSlug   string   `json:"eventSlug"`
	Summary     string   `json:"summary"`
	Detail      string   `json:"detail"`
	Condition   string   `json:"condition"`
	Rarity      string   `json:"rarity"`
	X           float64  `json:"x"`
	Y           float64  `json:"y"`
	LootScore   int      `json:"lootScore"`
	LayerName   string   `json:"layerName"`
	LayerIcon   string   `json:"layerIcon"`
	LayerColor  string   `json:"layerColor"`
	ImageURLs   []string `json:"imageUrls"`
	SearchTerms string   `json:"-"`
}

type ViewStats struct {
	TotalPoints   int `json:"totalPoints"`
	VisiblePoints int `json:"visiblePoints"`
}

type MapViewResponse struct {
	Modes          []ModeSummary `json:"modes"`
	CurrentMode    ModeSummary   `json:"currentMode"`
	Maps           []MapSummary  `json:"maps"`
	CurrentMap     MapSummary    `json:"currentMap"`
	Variants       []Variant     `json:"variants"`
	CurrentVariant string        `json:"currentVariant"`
	Floors         []Floor       `json:"floors"`
	CurrentFloor   string        `json:"currentFloor"`
	RandomEvents   []RandomEvent `json:"randomEvents"`
	CurrentEvent   string        `json:"currentEvent"`
	Regions        []Region      `json:"regions"`
	LayerGroups    []LayerGroup  `json:"layerGroups"`
	SelectedLayers []string      `json:"selectedLayers"`
	Points         []Point       `json:"points"`
	Stats          ViewStats     `json:"stats"`
}

type MapViewQuery struct {
	ModeSlug   string
	MapSlug    string
	Variant    string
	Floor      string
	EventSlug  string
	LayerMode  string
	Search     string
	LayerSlugs []string
}
