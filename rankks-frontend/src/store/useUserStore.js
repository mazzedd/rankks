import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { api } from '../services/api'

const EMPTY_FAVOURITES = { sport: [], competition: [], club: [], athlete: [], media: [], f1_race_video: [], motogp_race_video: [], tour: [] }

const useUserStore = create(persist((set, get) => ({
  token: null,
  user: null,
  favourites: EMPTY_FAVOURITES,
  authModalOpen: false,
  authModalMode: 'signup', // 'signup' | 'login'
  capNotice: null, // { entity_type, message } — transient, shown by the star that triggered it

  openAuthModal: (mode = 'signup') => set({ authModalOpen: true, authModalMode: mode }),
  closeAuthModal: () => set({ authModalOpen: false }),

  signup: async (email, password, display_name) => {
    const { token, user } = await api.signup(email, password, display_name)
    set({ token, user, authModalOpen: false })
    get().loadFavourites()
  },

  login: async (email, password) => {
    const { token, user } = await api.login(email, password)
    set({ token, user, authModalOpen: false })
    get().loadFavourites()
  },

  logout: () => set({ token: null, user: null, favourites: EMPTY_FAVOURITES }),

  loadFavourites: async () => {
    const { token } = get()
    if (!token) return
    try {
      const favourites = await api.getFavourites(token)
      set({ favourites })
    } catch {
      // Expired/invalid token — drop the session rather than leave stale UI
      set({ token: null, user: null, favourites: EMPTY_FAVOURITES })
    }
  },

  isFavourited: (entity_type, entity_id) => {
    const list = get().favourites[entity_type] || []
    return list.some(f => f.entity_id === entity_id)
  },

  // Returns { added: true } | { removed: true } | { signedOut: true } | { capReached: true, message }
  toggleFavourite: async (entity_type, entity_id) => {
    const { token, favourites } = get()
    if (!token) {
      return { signedOut: true }
    }

    const list = favourites[entity_type] || []
    const existing = list.find(f => f.entity_id === entity_id)

    if (existing) {
      set({ favourites: { ...favourites, [entity_type]: list.filter(f => f.id !== existing.id) } })
      try {
        await api.removeFavourite(token, existing.id)
        return { removed: true }
      } catch (err) {
        set(state => ({ favourites: { ...state.favourites, [entity_type]: list } })) // rollback
        throw err
      }
    }

    const tempId = `temp-${Date.now()}`
    const optimisticRow = { id: tempId, entity_type, entity_id, display_order: 0, created_at: new Date().toISOString() }
    set({ favourites: { ...favourites, [entity_type]: [...list, optimisticRow] } })

    try {
      // The POST response only carries bare columns (id/entity_type/entity_id/…),
      // not the joined display fields (name/slug/image_url/sport_slug) that GET
      // provides — refetch so the temp placeholder gets replaced with the real,
      // enriched row instead of one missing everything the UI needs to render it.
      await api.addFavourite(token, entity_type, entity_id)
      await get().loadFavourites()
      return { added: true }
    } catch (err) {
      set(state => ({
        favourites: {
          ...state.favourites,
          [entity_type]: state.favourites[entity_type].filter(f => f.id !== tempId),
        },
      })) // rollback
      if (err.code === 'FAVOURITE_CAP_REACHED') {
        set({ capNotice: { entity_type, message: err.body.message } })
        return { capReached: true, message: err.body.message }
      }
      throw err
    }
  },

  clearCapNotice: () => set({ capNotice: null }),

  updatePreferences: async (show_odds_data) => {
    const { token, user } = get()
    const updated = await api.updatePreferences(token, user.id, show_odds_data)
    set({ user: updated })
  },
}), {
  name: 'rankks-user',
  partialize: (state) => ({ token: state.token, user: state.user }),
}))

export default useUserStore
