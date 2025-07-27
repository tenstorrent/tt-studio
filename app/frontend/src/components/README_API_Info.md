# API Info Feature

## Overview

The API Info feature provides a streamlined way to view and test API endpoints for deployed models in the TT Studio interface. It integrates directly into the existing "Models Deployed" page and uses the existing UI components and syntax highlighting capabilities.

## Features

### 1. API Information Display

- **Endpoints Tab**: Shows API URL, JWT token, and model information
- **Test API Tab**: Interactive console to test API endpoints with custom payloads
- **Examples Tab**: Code examples in cURL and JavaScript formats

### 2. Key Components

#### ModelAPIInfo Component (`ModelAPIInfo.tsx`)

- Displays API information in a tabbed interface
- Uses existing `CodeBlock` component for syntax highlighting
- Integrates with existing UI components (Card, Button, Badge, etc.)
- Provides copy-to-clipboard functionality for API credentials

#### Backend Integration

- New `ModelAPIInfoView` endpoint at `/models-api/api-info/`
- Returns real API information for all deployed models
- Generates appropriate JWT tokens and example payloads
- Supports different model types (Chat, Image Generation, Object Detection, Speech Recognition)

### 3. Integration Points

#### ModelsDeployedTable Integration

- Added "API" button to each model row in the table
- Button opens a dialog with the API information
- Uses existing dialog and tooltip components

#### Backend API Endpoint

- **URL**: `/models-api/api-info/`
- **Method**: GET
- **Response**: JSON object with API information for all deployed models
- **Fallback**: Frontend falls back to mock data if backend is unavailable

## Usage

### For Users

1. Navigate to the "Models Deployed" page
2. Click the "API" button next to any deployed model
3. View API information in the "Endpoints" tab
4. Test the API in the "Test API" tab
5. Copy code examples from the "Examples" tab

### For Developers

The feature is designed to be extensible:

#### Adding New Model Types

1. Update the `_get_endpoint_path()` method in `ModelAPIInfoView`
2. Add appropriate example payload in `_get_example_payload()`
3. Update curl example generation in `_get_curl_example()`

#### Customizing the UI

- The component uses existing UI components from `./ui/`
- Syntax highlighting uses the existing `CodeBlock` component
- Styling follows the existing design system

## Technical Details

### Frontend Dependencies

- Uses existing `shiki` for syntax highlighting (via `CodeBlock`)
- No additional dependencies required
- Integrates with existing theme system

### Backend Dependencies

- Uses existing JWT token generation
- Leverages `get_deploy_cache()` for model information
- Follows existing API patterns and error handling

### Error Handling

- Frontend gracefully falls back to mock data if backend fails
- Backend provides detailed error messages
- User-friendly error notifications via toast messages

## Future Enhancements

1. **Real-time API Testing**: Add support for streaming responses
2. **API Documentation**: Generate OpenAPI/Swagger documentation
3. **Rate Limiting Info**: Display API rate limits and quotas
4. **Authentication Methods**: Support for additional auth methods
5. **Response Validation**: Validate API responses against schemas

## Files Modified

### Frontend

- `src/components/ModelAPIInfo.tsx` (new)
- `src/components/ModelsDeployedTable.tsx` (updated)

### Backend

- `model_control/views.py` (added `ModelAPIInfoView`)
- `model_control/urls.py` (added API endpoint)

## Testing

The feature includes:

- Mock data fallback for development
- Real API testing capabilities
- Error handling and user feedback
- Responsive design for different screen sizes
